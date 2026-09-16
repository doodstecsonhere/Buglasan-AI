import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createOfflineTesseractImageProvider,
  type MediaAnalysisProvider,
  type OfflineTesseractRecognizer,
  type VideoAnalysisProgress,
  type VideoAnalysisResult,
  type VideoFrameAnalysis,
  type VideoEvidence,
} from '../src/ingestion/sourceInbox.ts'

const REQUIRED_PATHS = ['SOURCE_INBOX_FFPROBE_PATH', 'SOURCE_INBOX_FFMPEG_PATH', 'SOURCE_INBOX_WHISPER_CPP_PATH', 'SOURCE_INBOX_WHISPER_MODEL_PATH'] as const

export interface LocalVideoToolPaths {
  readonly ffprobePath: string
  readonly ffmpegPath: string
  readonly whisperCppPath: string
  readonly whisperModelPath: string
  readonly whisperModelSha256: string
}

export interface LocalVideoProviderOptions {
  readonly tools: LocalVideoToolPaths
  readonly recognizer: OfflineTesseractRecognizer
  readonly maxFrames?: number
  readonly runtime?: LocalVideoRuntime
}

export interface LocalVideoRuntime {
  readonly access: (path: string) => Promise<void>
  readonly mkdtemp: (prefix: string) => Promise<string>
  readonly readFile: {
    (path: string): Promise<Buffer>
    (path: string, encoding: 'utf8'): Promise<string>
  }
  readonly rm: (path: string, options: { readonly recursive: true; readonly force: true }) => Promise<void>
  readonly run: (executable: string, args: readonly string[]) => Promise<string>
  readonly writeFile: (path: string, bytes: Uint8Array) => Promise<void>
}

interface ProbeOutput { readonly format?: { readonly duration?: string }; readonly streams?: readonly { readonly codec_type?: string }[] }
const MAX_DURATION_SECONDS = 15 * 60
const OUTPUT_LIMIT_BYTES = 128 * 1024
const TOOL_TIMEOUT_MS = 90_000

export function requiredAbsoluteVideoToolPaths(env: NodeJS.ProcessEnv = process.env): LocalVideoToolPaths {
  const configured = Object.fromEntries(REQUIRED_PATHS.map((name) => [name, env[name]])) as Record<typeof REQUIRED_PATHS[number], string | undefined>
  for (const name of REQUIRED_PATHS) {
    const value = configured[name]
    if (!value || !isAbsolute(value)) throw new Error(`${name} must be explicitly configured as an absolute local path`)
  }
  const modelSha = env.SOURCE_INBOX_WHISPER_MODEL_SHA256
  if (!modelSha || !/^[a-f0-9]{64}$/i.test(modelSha)) throw new Error('SOURCE_INBOX_WHISPER_MODEL_SHA256 must be a SHA-256 hex digest')
  return { ffprobePath: configured.SOURCE_INBOX_FFPROBE_PATH!, ffmpegPath: configured.SOURCE_INBOX_FFMPEG_PATH!, whisperCppPath: configured.SOURCE_INBOX_WHISPER_CPP_PATH!, whisperModelPath: configured.SOURCE_INBOX_WHISPER_MODEL_PATH!, whisperModelSha256: modelSha.toLowerCase() }
}

async function requireReadable(path: string, label: string, runtime: LocalVideoRuntime): Promise<void> {
  try { await runtime.access(path) } catch { throw new Error(`${label} is unavailable at its configured local path`) }
}

async function run(executable: string, args: readonly string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error, value?: string) => { if (settled) return; settled = true; clearTimeout(timeout); if (error) reject(error); else resolve(value!) }
    const append = (current: string, chunk: Buffer) => (current.length >= OUTPUT_LIMIT_BYTES ? current : (current + chunk.toString('utf8')).slice(0, OUTPUT_LIMIT_BYTES))
    const timeout = setTimeout(() => { child.kill(); finish(new Error('local tool timed out')) }, TOOL_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    child.once('error', (error) => finish(new Error(`local tool failed to start: ${error.message}`)))
    child.once('close', (code) => code === 0 ? finish(undefined, stdout) : finish(new Error(`local tool exited with code ${code}: ${stderr.trim().slice(0, 500)}`)))
  })
}

function extensionFor(mimeType: string): string { return mimeType === 'video/webm' ? '.webm' : '.mp4' }

function normalizedText(value: string): string | null {
  const result = value.replace(/\s+/g, ' ').trim()
  return result === '' ? null : result.slice(0, 24_000)
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function formatTimestamp(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds)); const hours = Math.floor(total / 3_600_000); const minutes = Math.floor(total % 3_600_000 / 60_000); const seconds = Math.floor(total % 60_000 / 1_000); const millis = total % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}
function plannedTimestamps(duration: number, maxFrames: number): number[] {
  // Start, title-safe 1s, end-safe frame, then deterministic 30-second safety samples.
  const candidate = [0, Math.min(1, duration / 2), Math.max(0, duration - 0.5)]
  for (let second = 30; second < duration && candidate.length < maxFrames; second += 30) candidate.push(second)
  return [...new Set(candidate.map((value) => Math.round(value * 1000)))].slice(0, maxFrames)
}
function evidenceText(transcriptSegments: readonly { start: number; end: number; text: string }[], frames: readonly VideoFrameAnalysis[]): string {
  return [...transcriptSegments.map((segment) => `[SPEECH ${formatTimestamp(segment.start * 1000)}-${formatTimestamp(segment.end * 1000)}] ${segment.text}`), ...frames.filter((frame) => frame.ocr_text !== null).map((frame) => `[FRAME ${formatTimestamp(frame.timestamp_milliseconds)} OCR] ${frame.ocr_text}`)].join('\n')
}

/** Node-only, local process adapter. It accepts no URLs, makes no network calls, and removes its temporary workspace. */
export function createLocalVideoProvider(options: LocalVideoProviderOptions): MediaAnalysisProvider {
  const imageProvider = createOfflineTesseractImageProvider(options.recognizer)
  const maxFrames = options.maxFrames ?? 6
  const runtime: LocalVideoRuntime = options.runtime ?? { access, mkdtemp, readFile, rm, run, writeFile }
  if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 12) throw new Error('maxFrames must be an integer from 1 to 12')
  return {
    id: 'ffprobe-ffmpeg-whisper.cpp-local',
    version: '1',
    analyzeImage: imageProvider.analyzeImage,
    async analyzeVideo(video: VideoEvidence, bytes: Uint8Array, analyzedAt: string, onProgress?: (progress: VideoAnalysisProgress) => void): Promise<VideoAnalysisResult> {
      await Promise.all([requireReadable(options.tools.ffprobePath, 'ffprobe', runtime), requireReadable(options.tools.ffmpegPath, 'ffmpeg', runtime), requireReadable(options.tools.whisperCppPath, 'whisper.cpp', runtime), requireReadable(options.tools.whisperModelPath, 'whisper.cpp model', runtime)])
      if (sha256(new Uint8Array(await runtime.readFile(options.tools.whisperModelPath))) !== options.tools.whisperModelSha256) throw new Error('configured whisper.cpp model SHA-256 does not match SOURCE_INBOX_WHISPER_MODEL_SHA256')
      const workspace = await runtime.mkdtemp(join(tmpdir(), 'buglasan-source-inbox-'))
      const sourcePath = join(workspace, `source${extensionFor(video.mime_type)}`)
      const audioPath = join(workspace, 'audio.wav')
      const transcriptPath = join(workspace, 'transcript')
      try {
        await runtime.writeFile(sourcePath, bytes)
        onProgress?.({ stage: 'probing', completed: 0, total: null, message: 'Inspecting local video metadata' })
        const probe = JSON.parse(await runtime.run(options.tools.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', sourcePath])) as ProbeOutput
        const duration = Number(probe.format?.duration)
        if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS || !probe.streams?.some((stream) => stream.codec_type === 'video')) throw new Error('ffprobe did not report a playable video stream within the duration limit')
        const timestamps = plannedTimestamps(duration, maxFrames)
        onProgress?.({ stage: 'extracting_frames', completed: 0, total: timestamps.length, message: 'Extracting bounded review frames locally' })
        const frames: VideoFrameAnalysis[] = []; const seenFrameHashes = new Set<string>()
        for (const [index, timestamp] of timestamps.entries()) {
          const framePath = join(workspace, `frame-${String(index + 1).padStart(2, '0')}.png`)
          try {
            await runtime.run(options.tools.ffmpegPath, ['-nostdin', '-v', 'error', '-ss', String(timestamp / 1000), '-i', sourcePath, '-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", '-y', framePath])
            const frame = new Uint8Array(await runtime.readFile(framePath))
            const frameSha256 = sha256(frame); if (seenFrameHashes.has(frameSha256)) continue; seenFrameHashes.add(frameSha256)
            const evidence = { kind: 'image' as const, name: basename(framePath), mime_type: 'image/png', size_bytes: frame.byteLength, sha256: frameSha256, validation: 'accepted' as const, duplicate_of: null, failure: null }
            onProgress?.({ stage: 'ocr', completed: frames.length, total: timestamps.length, message: `OCR review frame ${index + 1} locally` })
            frames.push({ ...await imageProvider.analyzeImage(evidence, frame, analyzedAt), frame_sha256: frameSha256, timestamp_milliseconds: timestamp })
          } catch { /* retain previously extracted evidence and continue sampling */ }
        }
        const hasAudio = probe.streams.some((stream) => stream.codec_type === 'audio')
        let transcript: string | null = null; let transcriptSegments: { start: number; end: number; text: string }[] = []; const warnings: string[] = []; let transcriptionFailure: string | null = null
        if (hasAudio) {
          onProgress?.({ stage: 'transcribing', completed: 0, total: null, message: 'Transcribing local audio with whisper.cpp' })
          try {
            await runtime.run(options.tools.ffmpegPath, ['-nostdin', '-v', 'error', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-y', audioPath])
            await runtime.run(options.tools.whisperCppPath, ['-m', options.tools.whisperModelPath, '-f', audioPath, '-oj', '-of', transcriptPath])
            const parsed: unknown = JSON.parse(await runtime.readFile(`${transcriptPath}.json`, 'utf8'))
            if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as { transcription?: unknown }).transcription)) throw new Error('whisper.cpp JSON output did not contain a transcription array')
            transcriptSegments = (parsed as { transcription: unknown[] }).transcription.map((segment) => {
              if (segment === null || typeof segment !== 'object') throw new Error('whisper.cpp JSON output contained an invalid transcription segment')
              const { offsets, text: rawText } = segment as { offsets?: unknown; text?: unknown }
              if (offsets === null || typeof offsets !== 'object' || typeof (offsets as { from?: unknown }).from !== 'number' || typeof (offsets as { to?: unknown }).to !== 'number' || !Number.isFinite((offsets as { from: number }).from) || !Number.isFinite((offsets as { to: number }).to) || typeof rawText !== 'string') throw new Error('whisper.cpp JSON output contained an invalid transcription segment')
              const text = normalizedText(rawText)
              return text === null ? null : { start: (offsets as { from: number }).from / 1000, end: (offsets as { to: number }).to / 1000, text }
            }).filter((segment): segment is { start: number; end: number; text: string } => segment !== null)
            transcript = normalizedText(transcriptSegments.map((segment) => segment.text).join(' '))
          } catch (error) {
            transcriptionFailure = error instanceof Error ? error.message : 'unknown local transcription failure'
            warnings.push('Local audio transcription failed; retained visual analysis for diagnostics only.')
          }
        }
        const needsReview = transcript !== null || frames.some((frame) => frame.review_state === 'needs_review')
        onProgress?.({ stage: 'complete', completed: frames.length, total: frames.length, message: 'Local video analysis complete' })
        return { video_sha256: video.sha256, provider: 'ffprobe-ffmpeg-whisper.cpp-local', provider_version: '1', method: 'ffprobe+ffmpeg+tesseract+whisper.cpp', analyzed_at: analyzedAt, review_state: transcriptionFailure === null ? needsReview ? 'needs_review' : 'not_required' : 'failed', transcript_state: transcriptionFailure === null ? transcript === null ? 'no_text' : 'text' : 'unknown', transcript, duration_seconds: duration, frame_count: frames.length, frame_analyses: frames, derived_evidence: evidenceText(transcriptSegments, frames), observations: [`ffprobe reported ${duration.toFixed(2)} seconds.`, `Extracted ${frames.length} bounded review frame(s) locally.`], warnings: [...warnings, ...(hasAudio ? [] : ['No audio stream was present; transcription was not attempted.']), ...(frames.length === 0 ? ['No useful visual text was detected in selected frames.'] : []), ...(transcriptionFailure === null && needsReview ? ['Machine-generated frame OCR and transcript require operator review before approval.'] : [])], failure: transcriptionFailure === null ? null : `Local audio transcription failed: ${transcriptionFailure}` }
      } finally {
        await runtime.rm(workspace, { recursive: true, force: true })
      }
    },
  }
}
