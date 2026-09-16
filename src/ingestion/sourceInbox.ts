import { ingestGenericCollectorRecord, type SourceCollectorDispatch } from './genericCollectorIngress'
import type { JsonObject, SourceIngestionPayload, SourceType } from './sourceIngestion'

/**
 * Local, operator-only preparation boundary for material the operator already has.
 * It deliberately holds no credentials, does no network I/O, and does not persist files.
 */
export const SOURCE_INBOX_LIMITS = {
  maxImages: 8,
  maxImageBytes: 8 * 1024 * 1024,
  maxVideos: 1,
  maxVideoBytes: 256 * 1024 * 1024,
  maxVideoDurationSeconds: 15 * 60,
  maxVideoFrames: 12,
  maxImageNameLength: 256,
  maxCaptionLength: 12_000,
  maxOcrTextLength: 24_000,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  acceptedVideoMimeTypes: ['video/mp4', 'video/webm'] as const,
} as const

export type InboxMediaKind = 'image' | 'video'
export type AnalysisReviewState = 'not_required' | 'needs_review' | 'failed'
export type AnalysisTextState = 'text' | 'no_text' | 'unknown'

export interface SourceInboxImage {
  readonly name: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export interface SourceInboxVideo {
  readonly name: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export interface ImageEvidence {
  readonly kind: 'image'
  readonly name: string
  readonly mime_type: string
  readonly size_bytes: number
  readonly sha256: string
  readonly validation: 'accepted' | 'rejected'
  readonly duplicate_of: string | null
  readonly failure: string | null
}

export interface ImageAnalysisResult {
  readonly image_sha256: string
  readonly provider: string
  readonly provider_version: string
  readonly method: 'ocr' | 'vision'
  readonly analyzed_at: string
  readonly confidence: number | null
  /** How the provider produced the text, retained for an operator's review. */
  readonly granularity: 'document' | 'line' | 'unknown'
  readonly review_state: AnalysisReviewState
  readonly text_state: AnalysisTextState
  readonly ocr_text: string | null
  readonly observations: string[]
  readonly warnings: string[]
  readonly failure: string | null
}

export interface VideoEvidence {
  readonly kind: 'video'
  readonly name: string
  readonly mime_type: string
  readonly size_bytes: number
  readonly sha256: string
  readonly validation: 'accepted' | 'rejected'
  readonly duplicate_of: string | null
  readonly failure: string | null
}

export interface VideoAnalysisResult {
  readonly video_sha256: string
  readonly provider: string
  readonly provider_version: string
  readonly method: 'ffprobe+ffmpeg+tesseract+whisper.cpp'
  readonly analyzed_at: string
  readonly review_state: AnalysisReviewState
  readonly transcript_state: AnalysisTextState
  readonly transcript: string | null
  readonly duration_seconds: number | null
  readonly frame_count: number
  readonly frame_analyses: readonly VideoFrameAnalysis[]
  /** Stable, citeable local derivative. It never contains a filesystem path or media bytes. */
  readonly derived_evidence: string
  readonly observations: string[]
  readonly warnings: string[]
  readonly failure: string | null
}

export interface VideoFrameAnalysis extends ImageAnalysisResult {
  readonly frame_sha256: string
  readonly timestamp_milliseconds: number
}

/**
 * Minimal adapter for a locally provisioned Tesseract.js recognizer. The inbox
 * supplies bytes only: the host is responsible for configuring local worker,
 * core, and language-data paths, so this boundary cannot initiate a download.
 */
export interface OfflineTesseractRecognizer {
  recognize(bytes: Uint8Array): Promise<{ readonly data: { readonly text: string; readonly confidence?: number } }>
}

export interface MediaAnalysisProvider {
  readonly id: string
  readonly version: string
  analyzeImage(image: ImageEvidence, bytes: Uint8Array, analyzedAt: string): Promise<ImageAnalysisResult>
  analyzeVideo?(video: VideoEvidence, bytes: Uint8Array, analyzedAt: string, onProgress?: (progress: VideoAnalysisProgress) => void): Promise<VideoAnalysisResult>
}

export interface VideoAnalysisProgress {
  readonly stage: 'probing' | 'extracting_frames' | 'ocr' | 'transcribing' | 'complete'
  readonly completed: number
  readonly total: number | null
  readonly message: string
}

export interface SourceInboxInput {
  readonly facebookPostUrl: string
  readonly operatorCaption?: string | null
  readonly images: readonly SourceInboxImage[]
  readonly videos?: readonly SourceInboxVideo[]
  readonly collectedAt: string
  readonly festivalYear?: number | null
}

export interface SourceInboxPreview {
  readonly replay_key: string
  readonly reference: { readonly platform: 'facebook'; readonly post_url: string; readonly identity: string }
  readonly operator_caption: string | null
  readonly festival_year: number | null
  readonly image_evidence: readonly ImageEvidence[]
  readonly video_evidence: readonly VideoEvidence[]
  readonly analyses: readonly ImageAnalysisResult[]
  readonly video_analyses: readonly VideoAnalysisResult[]
  /** Human confirmation is required for any OCR text before it can be approved. */
  readonly requires_ocr_review: boolean
  readonly status: 'ready_for_approval' | 'reference_only' | 'failed'
  readonly usable_content: boolean
  readonly source_type: SourceType
  readonly failure: string | null
}

export class SourceInboxValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceInboxValidationError'
  }
}

function validFacebookUrl(value: string): string {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const isOfficialBuglasanPath = /^\/Buglasan(?:\/|$)/i.test(url.pathname)
    if (url.protocol !== 'https:' || url.username || url.password || (hostname !== 'facebook.com' && hostname !== 'www.facebook.com' && hostname !== 'm.facebook.com') || !isOfficialBuglasanPath) throw new Error()
    return url.toString()
  } catch {
    throw new SourceInboxValidationError('facebookPostUrl must be an HTTPS official facebook.com/Buglasan URL without embedded credentials')
  }
}

function hasSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mimeType === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  if (mimeType === 'image/webp') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  return false
}

function hasVideoSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'video/webm') return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  if (mimeType === 'video/mp4') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
  return false
}

async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalizedCaption(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === '') return null
  const normalized = value.trim()
  if (normalized.length > SOURCE_INBOX_LIMITS.maxCaptionLength) throw new SourceInboxValidationError(`operatorCaption must not exceed ${SOURCE_INBOX_LIMITS.maxCaptionLength} characters`)
  return normalized
}

function normalizedCollectedAt(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new SourceInboxValidationError('collectedAt must be a valid ISO-8601 timestamp')
  return date.toISOString()
}

function normalizeOcrText(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized === '' ? null : normalized.slice(0, SOURCE_INBOX_LIMITS.maxOcrTextLength)
}

/** Creates a zero-cost OCR provider backed by an already-local Tesseract.js runtime. */
export function createOfflineTesseractImageProvider(recognizer: OfflineTesseractRecognizer): MediaAnalysisProvider {
  return {
    id: 'tesseract.js-local',
    version: '6-compatible',
    async analyzeImage(image, bytes, analyzedAt) {
      const result = await recognizer.recognize(bytes)
      const text = normalizeOcrText(result.data.text)
      return {
        image_sha256: image.sha256,
        provider: 'tesseract.js-local',
        provider_version: '6-compatible',
        method: 'ocr',
        analyzed_at: analyzedAt,
        confidence: typeof result.data.confidence === 'number' && Number.isFinite(result.data.confidence) ? result.data.confidence : null,
        granularity: 'document',
        review_state: text === null ? 'not_required' : 'needs_review',
        text_state: text === null ? 'no_text' : 'text',
        ocr_text: text,
        observations: text === null ? ['No machine-readable text detected.'] : ['OCR text requires operator review before approval.'],
        warnings: text === null ? [] : ['OCR is machine-generated and must be checked against the source image.'],
        failure: null,
      }
    },
  }
}

/** A deterministic local provider for fixtures and offline operator review; it never reads image pixels as text. */
export const deterministicLocalImageProvider: MediaAnalysisProvider = {
  id: 'deterministic-local',
  version: '1',
  async analyzeImage(image, _bytes, analyzedAt) {
    return {
      image_sha256: image.sha256,
      provider: 'deterministic-local',
      provider_version: '1',
      method: 'ocr',
      analyzed_at: analyzedAt,
      confidence: null,
      granularity: 'unknown',
      review_state: 'not_required',
      text_state: 'unknown',
      ocr_text: null,
      observations: [],
      warnings: ['No local OCR runtime was configured for this analysis.'],
      failure: null,
    }
  },
}

export async function analyzeSourceInbox(input: SourceInboxInput, provider: MediaAnalysisProvider = deterministicLocalImageProvider): Promise<SourceInboxPreview> {
  const postUrl = validFacebookUrl(input.facebookPostUrl)
  if (!Array.isArray(input.images) || input.images.length > SOURCE_INBOX_LIMITS.maxImages) throw new SourceInboxValidationError(`images must contain 0 to ${SOURCE_INBOX_LIMITS.maxImages} items`)
  const videos = input.videos ?? []
  if (!Array.isArray(videos) || videos.length > SOURCE_INBOX_LIMITS.maxVideos) throw new SourceInboxValidationError(`videos must contain 0 to ${SOURCE_INBOX_LIMITS.maxVideos} items`)
  const caption = normalizedCaption(input.operatorCaption)
  const collectedAt = normalizedCollectedAt(input.collectedAt)
  const seenHashes = new Set<string>()
  const evidence: ImageEvidence[] = []
  for (const image of input.images) {
    if (typeof image.name !== 'string' || image.name.trim() === '' || image.name.length > SOURCE_INBOX_LIMITS.maxImageNameLength) throw new SourceInboxValidationError(`image name must contain 1 to ${SOURCE_INBOX_LIMITS.maxImageNameLength} characters`)
    if (!(image.bytes instanceof Uint8Array)) throw new SourceInboxValidationError('image bytes must be a Uint8Array')
    const hash = await sha256(image.bytes)
    const acceptedMime = SOURCE_INBOX_LIMITS.acceptedMimeTypes.includes(image.mimeType as typeof SOURCE_INBOX_LIMITS.acceptedMimeTypes[number])
    const duplicate = seenHashes.has(hash)
    seenHashes.add(hash)
    const failure = !acceptedMime ? 'unsupported MIME type' : image.bytes.byteLength === 0 ? 'empty image' : image.bytes.byteLength > SOURCE_INBOX_LIMITS.maxImageBytes ? 'image exceeds size limit' : !hasSignature(image.mimeType, image.bytes) ? 'MIME signature mismatch or malformed image' : duplicate ? 'duplicate image bytes' : null
    evidence.push({ kind: 'image', name: image.name, mime_type: image.mimeType, size_bytes: image.bytes.byteLength, sha256: hash, validation: failure === null ? 'accepted' : 'rejected', duplicate_of: duplicate ? hash : null, failure })
  }
  const videoEvidence: VideoEvidence[] = []
  for (const video of videos) {
    if (typeof video.name !== 'string' || video.name.trim() === '' || video.name.length > SOURCE_INBOX_LIMITS.maxImageNameLength) throw new SourceInboxValidationError(`video name must contain 1 to ${SOURCE_INBOX_LIMITS.maxImageNameLength} characters`)
    if (!(video.bytes instanceof Uint8Array)) throw new SourceInboxValidationError('video bytes must be a Uint8Array')
    const hash = await sha256(video.bytes)
    const acceptedMime = SOURCE_INBOX_LIMITS.acceptedVideoMimeTypes.includes(video.mimeType as typeof SOURCE_INBOX_LIMITS.acceptedVideoMimeTypes[number])
    const duplicate = seenHashes.has(hash)
    seenHashes.add(hash)
    const failure = !acceptedMime ? 'unsupported video MIME type' : video.bytes.byteLength === 0 ? 'empty video' : video.bytes.byteLength > SOURCE_INBOX_LIMITS.maxVideoBytes ? 'video exceeds size limit' : !hasVideoSignature(video.mimeType, video.bytes) ? 'video MIME signature mismatch or malformed video' : duplicate ? 'duplicate media bytes' : null
    videoEvidence.push({ kind: 'video', name: video.name, mime_type: video.mimeType, size_bytes: video.bytes.byteLength, sha256: hash, validation: failure === null ? 'accepted' : 'rejected', duplicate_of: duplicate ? hash : null, failure })
  }
  const identityHash = await sha256(postUrl)
  const replayKey = await sha256(JSON.stringify({ postUrl, caption, images: evidence.map(({ sha256: hash }) => hash), videos: videoEvidence.map(({ sha256: hash }) => hash) }))
  const analyses = await Promise.all(evidence.map(async (image, index) => {
    if (image.failure !== null) return failedAnalysis(image, provider, collectedAt, image.failure)
    try { return await provider.analyzeImage(image, input.images[index].bytes, collectedAt) } catch (error) { return failedAnalysis(image, provider, collectedAt, error instanceof Error ? error.message : 'provider error') }
  }))
  const videoAnalyses = await Promise.all(videoEvidence.map(async (video, index) => {
    if (video.failure !== null) return failedVideoAnalysis(video, provider, collectedAt, video.failure)
    if (!provider.analyzeVideo) return failedVideoAnalysis(video, provider, collectedAt, 'local video provider is not configured')
    try { return await provider.analyzeVideo(video, videos[index].bytes, collectedAt) } catch (error) { return failedVideoAnalysis(video, provider, collectedAt, error instanceof Error ? error.message : 'provider error') }
  }))
  const acceptedImages = evidence.filter((image) => image.validation === 'accepted')
  const acceptedVideos = videoEvidence.filter((video) => video.validation === 'accepted' && videoAnalyses.some((analysis) => analysis.video_sha256 === video.sha256 && analysis.failure === null))
  const usableContent = caption !== null || acceptedImages.length > 0 || acceptedVideos.length > 0
  const status = !usableContent ? evidence.length + videoEvidence.length === 0 ? 'reference_only' : 'failed' : 'ready_for_approval'
  const requiresOcrReview = analyses.some((analysis) => analysis.review_state === 'needs_review') || videoAnalyses.some((analysis) => analysis.review_state === 'needs_review')
  const mediaKinds = Number(acceptedImages.length > 0) + Number(acceptedVideos.length > 0)
  const sourceType: SourceType = caption !== null && mediaKinds > 0 || mediaKinds > 1 ? 'mixed' : acceptedVideos.length ? 'video' : acceptedImages.length ? 'image' : caption !== null ? 'text' : 'link'
  return { replay_key: replayKey, reference: { platform: 'facebook', post_url: postUrl, identity: `source-inbox-${identityHash.slice(0, 24)}` }, operator_caption: caption, festival_year: input.festivalYear ?? null, image_evidence: evidence, video_evidence: videoEvidence, analyses, video_analyses: videoAnalyses, requires_ocr_review: requiresOcrReview, status, usable_content: usableContent, source_type: sourceType, failure: status === 'reference_only' ? 'reference-only submissions cannot be approved' : status === 'failed' ? 'no valid image, analyzed video, or caption content is available' : null }
}

function failedAnalysis(image: ImageEvidence, provider: MediaAnalysisProvider, analyzedAt: string, failure: string): ImageAnalysisResult {
  return { image_sha256: image.sha256, provider: provider.id, provider_version: provider.version, method: 'ocr', analyzed_at: analyzedAt, confidence: null, granularity: 'unknown', review_state: 'failed', text_state: 'unknown', ocr_text: null, observations: [], warnings: ['OCR could not be completed for this image.'], failure }
}

function failedVideoAnalysis(video: VideoEvidence, provider: MediaAnalysisProvider, analyzedAt: string, failure: string): VideoAnalysisResult {
  return { video_sha256: video.sha256, provider: provider.id, provider_version: provider.version, method: 'ffprobe+ffmpeg+tesseract+whisper.cpp', analyzed_at: analyzedAt, review_state: 'failed', transcript_state: 'unknown', transcript: null, duration_seconds: null, frame_count: 0, frame_analyses: [], derived_evidence: '', observations: [], warnings: ['Video analysis could not be completed locally.'], failure }
}

/** Explicit approval is the sole point that delegates to the established collector ingress. */
export function approveSourceInboxPreview<Result>(preview: SourceInboxPreview, dispatch: SourceCollectorDispatch<Result>, options: { readonly confirmOcrReview?: boolean } = {}): Result {
  if (!preview.usable_content || preview.status !== 'ready_for_approval') throw new SourceInboxValidationError('Only usable, analyzed previews can be approved')
  if (preview.requires_ocr_review && options.confirmOcrReview !== true) throw new SourceInboxValidationError('OCR output requires explicit operator confirmation before approval')
  const metadata: JsonObject = {
    source_inbox: {
      replay_key: preview.replay_key,
      operator_caption: preview.operator_caption,
      image_evidence: preview.image_evidence.map((image) => ({ ...image })),
      analyses: preview.analyses.map((analysis) => ({ ...analysis })),
      video_evidence: preview.video_evidence.map((video) => ({ ...video })),
      video_analyses: preview.video_analyses.map((analysis) => ({ ...analysis, frame_analyses: analysis.frame_analyses.map((frame) => ({ ...frame })) })),
    },
  }
  return ingestGenericCollectorRecord({
    source: { type: 'facebook', identity: preview.reference.identity, reference: preview.reference.post_url },
    event: { cycle: null, festival_year: preview.festival_year }, published_at: null,
    // Operator caption is provenance only. Derived local evidence is the only media text
    // passed through the established ingress, never represented as Facebook body text.
    content: { raw_text: derivedIngressText(preview), normalized_text: derivedIngressText(preview), title: null, source_type: preview.source_type, media_urls: [] },
    metadata, authority: { label: 'Operator-provided official Buglasan Facebook reference', official: true },
    acquisition: { state: 'operator_provided_content', collected_at: preview.analyses[0]?.analyzed_at ?? preview.video_analyses[0]?.analyzed_at ?? new Date().toISOString(), collection_method: 'manual' },
    eligibility: { eligible: true, reason: null }, validation: { failure: null },
  }, dispatch)
}

function derivedIngressText(preview: SourceInboxPreview): string | null {
  const text = preview.video_analyses.filter((analysis) => analysis.failure === null).map((analysis) => analysis.derived_evidence).filter(Boolean).join('\n\n')
  return text === '' ? null : text
}

export type { SourceIngestionPayload }
