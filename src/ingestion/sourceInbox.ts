import { ingestGenericCollectorRecord, type SourceCollectorDispatch } from './genericCollectorIngress'
import type { JsonObject, SourceIngestionPayload, SourceType } from './sourceIngestion'

/**
 * Local, operator-only preparation boundary for material the operator already has.
 * It deliberately holds no credentials, does no network I/O, and does not persist files.
 */
export const SOURCE_INBOX_LIMITS = {
  maxImages: 8,
  maxImageBytes: 8 * 1024 * 1024,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const

export type InboxMediaKind = 'image' | 'video'
export type AnalysisReviewState = 'not_required' | 'needs_review' | 'failed'
export type AnalysisTextState = 'text' | 'no_text' | 'unknown'

export interface SourceInboxImage {
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
  readonly failure: string | null
}

export interface ImageAnalysisResult {
  readonly image_sha256: string
  readonly provider: string
  readonly provider_version: string
  readonly method: 'ocr' | 'vision'
  readonly analyzed_at: string
  readonly confidence: number | null
  readonly review_state: AnalysisReviewState
  readonly text_state: AnalysisTextState
  readonly ocr_text: string | null
  readonly observations: string[]
  readonly failure: string | null
}

/** Future providers may add video while this image-only inbox rejects it today. */
export interface MediaAnalysisProvider {
  readonly id: string
  readonly version: string
  analyzeImage(image: ImageEvidence, bytes: Uint8Array, analyzedAt: string): Promise<ImageAnalysisResult>
  analyzeVideo?(input: unknown): Promise<never>
}

export interface SourceInboxInput {
  readonly facebookPostUrl: string
  readonly operatorCaption?: string | null
  readonly images: readonly SourceInboxImage[]
  readonly collectedAt: string
  readonly festivalYear?: number | null
}

export interface SourceInboxPreview {
  readonly replay_key: string
  readonly reference: { readonly platform: 'facebook'; readonly post_url: string; readonly identity: string }
  readonly operator_caption: string | null
  readonly festival_year: number | null
  readonly image_evidence: readonly ImageEvidence[]
  readonly analyses: readonly ImageAnalysisResult[]
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

async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalizedCaption(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === '') return null
  return value.trim()
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
      review_state: 'not_required',
      text_state: 'unknown',
      ocr_text: null,
      observations: [],
      failure: null,
    }
  },
}

export async function analyzeSourceInbox(input: SourceInboxInput, provider: MediaAnalysisProvider = deterministicLocalImageProvider): Promise<SourceInboxPreview> {
  const postUrl = validFacebookUrl(input.facebookPostUrl)
  if (!Array.isArray(input.images) || input.images.length > SOURCE_INBOX_LIMITS.maxImages) throw new SourceInboxValidationError(`images must contain 0 to ${SOURCE_INBOX_LIMITS.maxImages} items`)
  const caption = normalizedCaption(input.operatorCaption)
  const evidence = await Promise.all(input.images.map(async (image) => {
    const acceptedMime = SOURCE_INBOX_LIMITS.acceptedMimeTypes.includes(image.mimeType as typeof SOURCE_INBOX_LIMITS.acceptedMimeTypes[number])
    const failure = !acceptedMime ? 'unsupported MIME type' : image.bytes.byteLength === 0 ? 'empty image' : image.bytes.byteLength > SOURCE_INBOX_LIMITS.maxImageBytes ? 'image exceeds size limit' : !hasSignature(image.mimeType, image.bytes) ? 'MIME signature mismatch or malformed image' : null
    return { kind: 'image' as const, name: image.name, mime_type: image.mimeType, size_bytes: image.bytes.byteLength, sha256: await sha256(image.bytes), validation: failure === null ? 'accepted' as const : 'rejected' as const, failure }
  }))
  const identityHash = await sha256(postUrl)
  const replayKey = await sha256(JSON.stringify({ postUrl, caption, images: evidence.map(({ sha256: hash }) => hash) }))
  const analyses = await Promise.all(evidence.map(async (image, index) => {
    if (image.failure !== null) return failedAnalysis(image, provider, input.collectedAt, image.failure)
    try { return await provider.analyzeImage(image, input.images[index].bytes, input.collectedAt) } catch (error) { return failedAnalysis(image, provider, input.collectedAt, error instanceof Error ? error.message : 'provider error') }
  }))
  const acceptedImages = evidence.filter((image) => image.validation === 'accepted')
  const usableContent = caption !== null || acceptedImages.length > 0
  const status = !usableContent ? evidence.length === 0 ? 'reference_only' : 'failed' : 'ready_for_approval'
  return { replay_key: replayKey, reference: { platform: 'facebook', post_url: postUrl, identity: `source-inbox-${identityHash.slice(0, 24)}` }, operator_caption: caption, festival_year: input.festivalYear ?? null, image_evidence: evidence, analyses, status, usable_content: usableContent, source_type: caption !== null && acceptedImages.length ? 'mixed' : acceptedImages.length ? 'image' : caption !== null ? 'text' : 'link', failure: status === 'reference_only' ? 'reference-only submissions cannot be approved' : status === 'failed' ? 'no valid image or caption content is available' : null }
}

function failedAnalysis(image: ImageEvidence, provider: MediaAnalysisProvider, analyzedAt: string, failure: string): ImageAnalysisResult {
  return { image_sha256: image.sha256, provider: provider.id, provider_version: provider.version, method: 'ocr', analyzed_at: analyzedAt, confidence: null, review_state: 'failed', text_state: 'unknown', ocr_text: null, observations: [], failure }
}

/** Explicit approval is the sole point that delegates to the established collector ingress. */
export function approveSourceInboxPreview<Result>(preview: SourceInboxPreview, dispatch: SourceCollectorDispatch<Result>): Result {
  if (!preview.usable_content || preview.status !== 'ready_for_approval') throw new SourceInboxValidationError('Only usable, analyzed previews can be approved')
  const metadata: JsonObject = {
    source_inbox: {
      replay_key: preview.replay_key,
      operator_caption: preview.operator_caption,
      image_evidence: preview.image_evidence.map((image) => ({ ...image })),
      analyses: preview.analyses.map((analysis) => ({ ...analysis })),
    },
  }
  return ingestGenericCollectorRecord({
    source: { type: 'facebook', identity: preview.reference.identity, reference: preview.reference.post_url },
    event: { cycle: null, festival_year: preview.festival_year }, published_at: null,
    content: { raw_text: preview.operator_caption, normalized_text: preview.operator_caption, title: null, source_type: preview.source_type, media_urls: [] },
    metadata, authority: { label: 'Operator-provided official Buglasan Facebook reference', official: true },
    acquisition: { state: 'operator_provided_content', collected_at: preview.analyses[0]?.analyzed_at ?? new Date().toISOString(), collection_method: 'manual' },
    eligibility: { eligible: true, reason: null }, validation: { failure: null },
  }, dispatch)
}

export type { SourceIngestionPayload }
