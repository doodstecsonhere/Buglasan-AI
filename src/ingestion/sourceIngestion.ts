/** Canonical source-only collector contract shared by adapters and tooling. */
export type SourceType = 'text' | 'image' | 'video' | 'link' | 'mixed' | 'unknown'
export type CollectionMethod = 'manual' | 'meta_graph_api' | 'admin_export' | 'other'
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export interface SourceIngestionPayload {
  platform: 'facebook'
  post_id: string
  post_url: string
  published_at: string | null
  post_year: number | null
  festival_year: number | null
  raw_text: string | null
  normalized_text: string | null
  title: string | null
  source_type: SourceType
  media_urls: string[]
  collected_at: string
  collection_method: CollectionMethod
  source_metadata: JsonObject
}

export class SourceIngestionValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid source ingestion payload: ${issues.join('; ')}`)
    this.name = 'SourceIngestionValidationError'
    this.issues = issues
  }
}

const SOURCE_TYPES = new Set<SourceType>(['text', 'image', 'video', 'link', 'mixed', 'unknown'])
const COLLECTION_METHODS = new Set<CollectionMethod>(['manual', 'meta_graph_api', 'admin_export', 'other'])
const EXPECTED_KEYS = new Set<keyof SourceIngestionPayload>([
  'platform', 'post_id', 'post_url', 'published_at', 'post_year', 'festival_year',
  'raw_text', 'normalized_text', 'title', 'source_type', 'media_urls', 'collected_at',
  'collection_method', 'source_metadata',
])
const MIN_YEAR = 1900
const MAX_YEAR = 2100
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const MANILA_YEAR = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validYear(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= MIN_YEAR && Number(value) <= MAX_YEAR
}

function normalizeTimestamp(value: unknown, field: string, nullable: boolean, issues: string[]): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) {
    issues.push(`${field} must be ${nullable ? 'null or ' : ''}an RFC 3339 timestamp with a timezone`)
    return null
  }
  return new Date(value).toISOString()
}

function normalizeHttpUrl(value: unknown, field: string, issues: string[]): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${field} must be a non-empty HTTP(S) URL`)
    return null
  }
  const candidate = value.trim()
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsafe URL')
    return candidate
  } catch {
    issues.push(`${field} must be a valid HTTP(S) URL without embedded credentials`)
    return null
  }
}

/**
 * Validates and deterministically normalizes a canonical payload.
 * Text, nulls, array order, and metadata values are deliberately preserved.
 */
export function normalizeSourceIngestionPayload(input: unknown): SourceIngestionPayload {
  const issues: string[] = []
  if (!isRecord(input)) throw new SourceIngestionValidationError(['payload must be an object'])

  for (const key of EXPECTED_KEYS) {
    if (!Object.hasOwn(input, key)) issues.push(`${key} is required (use null where allowed)`)
  }
  for (const key of Object.keys(input)) {
    if (!EXPECTED_KEYS.has(key as keyof SourceIngestionPayload)) issues.push(`unknown field: ${key}`)
  }

  if (input.platform !== 'facebook') issues.push('platform must be facebook')
  const postId = typeof input.post_id === 'string' ? input.post_id.trim() : ''
  if (!postId) issues.push('post_id must be a non-empty string')
  const postUrl = normalizeHttpUrl(input.post_url, 'post_url', issues)
  const publishedAt = normalizeTimestamp(input.published_at, 'published_at', true, issues)
  const collectedAt = normalizeTimestamp(input.collected_at, 'collected_at', false, issues)

  if (input.post_year !== null && !validYear(input.post_year)) issues.push(`post_year must be null or an integer from ${MIN_YEAR} to ${MAX_YEAR}`)
  if (input.festival_year !== null && !validYear(input.festival_year)) issues.push(`festival_year must be null or an integer from ${MIN_YEAR} to ${MAX_YEAR}`)

  for (const field of ['raw_text', 'normalized_text', 'title'] as const) {
    if (input[field] !== null && typeof input[field] !== 'string') issues.push(`${field} must be a string or null`)
  }
  if (!SOURCE_TYPES.has(input.source_type as SourceType)) issues.push('source_type is invalid')
  if (!COLLECTION_METHODS.has(input.collection_method as CollectionMethod)) issues.push('collection_method is invalid')

  const mediaUrls: string[] = []
  if (!Array.isArray(input.media_urls)) {
    issues.push('media_urls must be an array')
  } else {
    input.media_urls.forEach((value, index) => {
      const url = normalizeHttpUrl(value, `media_urls[${index}]`, issues)
      if (url !== null) mediaUrls.push(url)
    })
  }
  if (!isRecord(input.source_metadata)) issues.push('source_metadata must be an object')

  const hasText = typeof input.raw_text === 'string' || typeof input.normalized_text === 'string'
  const hasNonTextEvidence = mediaUrls.length > 0 || (isRecord(input.source_metadata) && Object.keys(input.source_metadata).length > 0)
  if (!hasText && !hasNonTextEvidence) issues.push('text-null records require media_urls or source_metadata provenance')
  if (!hasText && input.source_type === 'text') issues.push('source_type text requires raw_text or normalized_text')

  if (issues.length > 0 || postUrl === null || collectedAt === null) {
    throw new SourceIngestionValidationError(issues)
  }

  // Published timestamp owns post_year in the festival's civil timezone. festival_year is never inferred.
  const postYear = publishedAt === null ? input.post_year as number | null : Number(MANILA_YEAR.format(new Date(publishedAt)))

  return {
    platform: 'facebook',
    post_id: postId,
    post_url: postUrl,
    published_at: publishedAt,
    post_year: postYear,
    festival_year: input.festival_year as number | null,
    raw_text: input.raw_text as string | null,
    normalized_text: input.normalized_text as string | null,
    title: input.title as string | null,
    source_type: input.source_type as SourceType,
    media_urls: mediaUrls,
    collected_at: collectedAt,
    collection_method: input.collection_method as CollectionMethod,
    source_metadata: input.source_metadata as JsonObject,
  }
}
