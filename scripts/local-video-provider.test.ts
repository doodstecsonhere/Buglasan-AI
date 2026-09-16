import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createLocalVideoProvider, requiredAbsoluteVideoToolPaths, type LocalVideoRuntime } from './local-video-provider.ts'

const tools = { ffprobePath: '/tools/ffprobe', ffmpegPath: '/tools/ffmpeg', whisperCppPath: '/tools/whisper', whisperModelPath: '/models/ggml.bin', whisperModelSha256: createHash('sha256').update('model').digest('hex') }
const video = { kind: 'video' as const, name: 'schedule.mp4', mime_type: 'video/mp4', size_bytes: 16, sha256: 'video-sha', validation: 'accepted' as const, duplicate_of: null, failure: null }

function mockedRuntime(options: { readonly audio?: boolean; readonly failFrames?: boolean; readonly failTranscript?: boolean; readonly failProbe?: boolean } = {}): { readonly runtime: LocalVideoRuntime; readonly commands: { executable: string; args: readonly string[] }[]; readonly removed: string[] } {
  const files = new Map<string, Buffer | string>([[tools.whisperModelPath, Buffer.from('model')]])
  const commands: { executable: string; args: readonly string[] }[] = []; const removed: string[] = []
  const runtime: LocalVideoRuntime = {
    access: async () => undefined,
    mkdtemp: async () => '/tmp/buglasan-source-inbox-test',
    readFile: ((path: string, encoding?: 'utf8') => {
      const value = files.get(path)
      if (value === undefined) return Promise.reject(new Error(`missing ${path}`))
      return Promise.resolve(encoding === 'utf8' ? value.toString() : Buffer.from(value))
    }) as LocalVideoRuntime['readFile'],
    rm: async (path) => { removed.push(path) },
    run: async (executable, args) => {
      commands.push({ executable, args })
      if (executable === tools.ffprobePath) {
        if (options.failProbe) throw new Error('local tool timed out')
        return JSON.stringify({ format: { duration: '61' }, streams: [{ codec_type: 'video' }, ...(options.audio === false ? [] : [{ codec_type: 'audio' }])] })
      }
      if (executable === tools.whisperCppPath) {
        if (options.failTranscript) throw new Error('whisper failed')
        files.set(`${args[args.indexOf('-of') + 1]}.json`, JSON.stringify({ transcription: [{ offsets: { from: 1000, to: 2500 }, text: ' Opening program ' }] }))
        return ''
      }
      if (args.includes('-frames:v')) {
        if (options.failFrames) throw new Error('frame extraction failed')
        const timestamp = args[args.indexOf('-ss') + 1]
        files.set(args.at(-1)!, Buffer.from(timestamp === '1' ? 'frame-0' : `frame-${timestamp}`))
      }
      return ''
    },
    writeFile: async (path, bytes) => { files.set(path, Buffer.from(bytes)) },
  }
  return { runtime, commands, removed }
}

describe('local video provider configuration gate', () => {
  it('requires absolute explicit tool paths, never relying on PATH', () => {
    expect(() => requiredAbsoluteVideoToolPaths({})).toThrow(/SOURCE_INBOX_FFPROBE_PATH/)
    expect(() => requiredAbsoluteVideoToolPaths({ SOURCE_INBOX_FFPROBE_PATH: 'ffprobe.exe', SOURCE_INBOX_FFMPEG_PATH: 'C:\\tools\\ffmpeg.exe', SOURCE_INBOX_WHISPER_CPP_PATH: 'C:\\tools\\whisper.exe', SOURCE_INBOX_WHISPER_MODEL_PATH: 'C:\\models\\ggml.bin' })).toThrow(/absolute/)
    expect(requiredAbsoluteVideoToolPaths({ SOURCE_INBOX_FFPROBE_PATH: 'C:\\tools\\ffprobe.exe', SOURCE_INBOX_FFMPEG_PATH: 'C:\\tools\\ffmpeg.exe', SOURCE_INBOX_WHISPER_CPP_PATH: 'C:\\tools\\whisper.exe', SOURCE_INBOX_WHISPER_MODEL_PATH: 'C:\\models\\ggml.bin', SOURCE_INBOX_WHISPER_MODEL_SHA256: 'a'.repeat(64) })).toMatchObject({ ffprobePath: 'C:\\tools\\ffprobe.exe' })
  })

  it('processes a valid MP4 entirely through fixed mocked local tools and cleans up', async () => {
    const mock = mockedRuntime(); const progress: string[] = []; let ocrCalls = 0
    const provider = createLocalVideoProvider({ tools, maxFrames: 4, runtime: mock.runtime, recognizer: { recognize: async () => ({ data: { text: ++ocrCalls === 2 ? '' : 'Festival schedule', confidence: 91 } }) } })
    const result = await provider.analyzeVideo!(video, new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]), '2026-01-01T00:00:00.000Z', (item) => progress.push(item.stage))
    expect(result).toMatchObject({ transcript: 'Opening program', duration_seconds: 61, frame_count: 3, derived_evidence: expect.stringMatching(/SPEECH 00:00:01\.000-00:00:02\.500/) })
    expect(result.derived_evidence).not.toMatch(/tmp|\.png|base64/i)
    expect(progress).toEqual(['probing', 'extracting_frames', 'ocr', 'ocr', 'ocr', 'transcribing', 'complete'])
    expect(mock.commands.every(({ executable }) => executable.startsWith('/'))).toBe(true)
    expect(mock.commands.map(({ executable }) => executable)).toContain(tools.ffprobePath)
    expect(mock.commands.map(({ executable }) => executable)).toContain(tools.whisperCppPath)
    expect(mock.removed).toEqual(['/tmp/buglasan-source-inbox-test'])
  })

  it('retains useful visual evidence when audio is absent or transcription fails', async () => {
    const noAudio = mockedRuntime({ audio: false })
    const noAudioResult = await createLocalVideoProvider({ tools, runtime: noAudio.runtime, recognizer: { recognize: async () => ({ data: { text: 'Visual result' } }) } }).analyzeVideo!(video, new Uint8Array([1]), '2026-01-01T00:00:00.000Z')
    expect(noAudioResult).toMatchObject({ transcript: null, frame_count: 4, warnings: expect.arrayContaining([expect.stringMatching(/No audio stream/)]) })
    const failedTranscript = mockedRuntime({ failTranscript: true })
    const failedTranscriptResult = await createLocalVideoProvider({ tools, runtime: failedTranscript.runtime, recognizer: { recognize: async () => ({ data: { text: 'Visual result' } }) } }).analyzeVideo!(video, new Uint8Array([1]), '2026-01-01T00:00:00.000Z')
    expect(failedTranscriptResult).toMatchObject({ transcript: null, frame_count: 4, warnings: expect.arrayContaining([expect.stringMatching(/transcription failed/)]) })
    expect(failedTranscript.removed).toHaveLength(1)
  })

  it('retains transcription and cleans up after every frame extraction fails', async () => {
    const mock = mockedRuntime({ failFrames: true })
    const result = await createLocalVideoProvider({ tools, runtime: mock.runtime, recognizer: { recognize: async () => ({ data: { text: 'unused' } }) } }).analyzeVideo!(video, new Uint8Array([1]), '2026-01-01T00:00:00.000Z')
    expect(result).toMatchObject({ transcript: 'Opening program', frame_count: 0, warnings: expect.arrayContaining([expect.stringMatching(/No useful visual/)]) })
    expect(mock.removed).toEqual(['/tmp/buglasan-source-inbox-test'])
  })

  it('cleans up when a fixed local command fails before processing can complete', async () => {
    const mock = mockedRuntime({ failProbe: true })
    const provider = createLocalVideoProvider({ tools, runtime: mock.runtime, recognizer: { recognize: async () => ({ data: { text: '' } }) } })
    await expect(provider.analyzeVideo!(video, new Uint8Array([1]), '2026-01-01T00:00:00.000Z')).rejects.toThrow(/timed out/)
    expect(mock.removed).toEqual(['/tmp/buglasan-source-inbox-test'])
  })
})
