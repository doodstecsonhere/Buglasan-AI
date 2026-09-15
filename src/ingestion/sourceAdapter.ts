import {
  normalizeSourceIngestionPayload,
  type CollectionMethod,
  type JsonObject,
  type SourceIngestionPayload,
  type SourceType,
} from './sourceIngestion'

/**
 * Phase 5 input boundary. It is deliberately passive: adapters describe content
 * already made available to the operator; this module never fetches a reference.
 */
export type SourceAdapterPlatform = 'facebook' | (string & {})
export type FacebookV1AcquisitionState =
  | 'reference_only'
  | 'embed_available'
  | 'authorized_content'
  | 'operator_provided_content'
  | 'unavailable'

export interface SourceAdapterRecord {
  readonly source: {
    readonly type: SourceAdapterPlatform
    readonly identity: string
    readonly reference: string
  }
  readonly event: {
    readonly cycle: string | null
    readonly festival_year: number | null
  }
  /** Null expressly represents a publication time that is not known. */
  readonly published_at: string | null
  readonly content: {
    readonly raw_text: string | null
    readonly normalized_text: string | null
    readonly title: string | null
    readonly source_type: SourceType
    readonly media_urls: string[]
  }
  readonly metadata: JsonObject
  /** Evidence authority is descriptive and is not product affiliation. */
  readonly authority: {
    readonly label: string
    readonly official: boolean
  }
  readonly acquisition: {
    readonly state: FacebookV1AcquisitionState | (string & {})
    readonly collected_at: string
    readonly collection_method: CollectionMethod
  }
  /** Eligibility is an explicit operator/policy decision, not inferred from a URL or embed. */
  readonly eligibility: {
    readonly eligible: boolean
    readonly reason: string | null
  }
  /** A failure or unavailable record is retained at this boundary but cannot be ingested. */
  readonly validation: {
    readonly failure: string | null
  }
}

export interface EventSourceAdapter<Input = unknown> {
  readonly id: string
  adapt(input: Input): SourceAdapterRecord
}

export class SourceAdapterMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceAdapterMappingError'
  }
}

const INGESTIBLE_FACEBOOK_STATES = new Set<FacebookV1AcquisitionState>([
  'authorized_content',
  'operator_provided_content',
])

function assertSafeHttpReference(reference: string): void {
  try {
    const url = new URL(reference)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
  } catch {
    throw new SourceAdapterMappingError('source.reference must be a valid HTTP(S) URL without embedded credentials')
  }
}

/**
 * Maps an accepted adapter record to the existing Facebook V1 collector payload.
 * This is a compatibility bridge, not a source selector or acquisition mechanism.
 */
export function mapSourceAdapterRecordToIngestionPayload(record: SourceAdapterRecord): SourceIngestionPayload {
  assertSafeHttpReference(record.source.reference)
  if (record.source.type !== 'facebook') {
    throw new SourceAdapterMappingError(`No collector target is selected for source type: ${record.source.type}`)
  }
  if (record.validation.failure !== null) {
    throw new SourceAdapterMappingError(`Source validation failed: ${record.validation.failure}`)
  }
  if (record.acquisition.state === 'unavailable') {
    throw new SourceAdapterMappingError('Unavailable source content cannot be ingested')
  }
  if (!INGESTIBLE_FACEBOOK_STATES.has(record.acquisition.state as FacebookV1AcquisitionState)) {
    throw new SourceAdapterMappingError('Facebook reference-only and embed-available states are not authorized or ingestible')
  }
  if (!record.eligibility.eligible) {
    throw new SourceAdapterMappingError(`Source is not eligible${record.eligibility.reason ? `: ${record.eligibility.reason}` : ''}`)
  }
  if (record.acquisition.state === 'operator_provided_content' && record.acquisition.collection_method !== 'manual') {
    throw new SourceAdapterMappingError('Operator-provided content must use the manual collection method')
  }
  if (record.acquisition.state === 'authorized_content' && record.acquisition.collection_method === 'manual') {
    throw new SourceAdapterMappingError('Authorized Facebook content must not be represented as operator-provided content')
  }

  return normalizeSourceIngestionPayload({
    platform: 'facebook',
    post_id: record.source.identity,
    post_url: record.source.reference,
    published_at: record.published_at,
    post_year: null,
    festival_year: record.event.festival_year,
    raw_text: record.content.raw_text,
    normalized_text: record.content.normalized_text,
    title: record.content.title,
    source_type: record.content.source_type,
    media_urls: record.content.media_urls,
    collected_at: record.acquisition.collected_at,
    collection_method: record.acquisition.collection_method,
    source_metadata: {
      ...record.metadata,
      source_adapter: {
        event_cycle: record.event.cycle,
        authority_label: record.authority.label,
        authority_official: record.authority.official,
        acquisition_state: record.acquisition.state,
        provenance: record.acquisition.state === 'operator_provided_content' ? 'operator_provided' : 'authorized_acquisition',
      },
    },
  })
}

/** Maps through an adapter without registering it in any production selection path. */
export function adaptToSourceIngestionPayload<Input>(adapter: EventSourceAdapter<Input>, input: Input): SourceIngestionPayload {
  return mapSourceAdapterRecordToIngestionPayload(adapter.adapt(input))
}
