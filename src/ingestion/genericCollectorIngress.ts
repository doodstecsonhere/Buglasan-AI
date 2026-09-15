import {
  mapSourceAdapterRecordToIngestionPayload,
  type SourceAdapterRecord,
} from './sourceAdapter'
import type { JsonObject, JsonValue, SourceIngestionPayload } from './sourceIngestion'

/** The established collector remains responsible for fingerprints and idempotency. */
export type SourceCollectorDispatch<Result> = (payload: SourceIngestionPayload) => Result

export class GenericCollectorIngressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenericCollectorIngressError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new GenericCollectorIngressError(`${field}.${key} is required`)
  }
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new GenericCollectorIngressError(`${field}.${key} is not allowed`)
}

function requireRecord(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new GenericCollectorIngressError(`${field} must be an object`)
  hasOnlyKeys(value, keys, field)
  return value
}

function requireString(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string') throw new GenericCollectorIngressError(`${field} must be ${nullable ? 'a string or null' : 'a string'}`)
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new GenericCollectorIngressError(`${field} must be a boolean`)
  return value
}

function requireNullableYear(value: unknown, field: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1900 || value > 2100) throw new GenericCollectorIngressError(`${field} must be null or an integer from 1900 to 2100`)
  return value
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

/**
 * Validates untrusted Phase 5 adapter output, translates it to the fixed collector
 * payload, then invokes the supplied collector boundary. It performs no acquisition.
 */
export function normalizeGenericCollectorIngressInput(input: unknown): SourceAdapterRecord {
  const root = requireRecord(input, 'record', ['source', 'event', 'published_at', 'content', 'metadata', 'authority', 'acquisition', 'eligibility', 'validation'])
  const source = requireRecord(root.source, 'source', ['type', 'identity', 'reference'])
  const event = requireRecord(root.event, 'event', ['cycle', 'festival_year'])
  const content = requireRecord(root.content, 'content', ['raw_text', 'normalized_text', 'title', 'source_type', 'media_urls'])
  const authority = requireRecord(root.authority, 'authority', ['label', 'official'])
  const acquisition = requireRecord(root.acquisition, 'acquisition', ['state', 'collected_at', 'collection_method'])
  const eligibility = requireRecord(root.eligibility, 'eligibility', ['eligible', 'reason'])
  const validation = requireRecord(root.validation, 'validation', ['failure'])

  if (!isRecord(root.metadata) || !isJsonValue(root.metadata)) throw new GenericCollectorIngressError('metadata must be a JSON object')
  if (!Array.isArray(content.media_urls) || content.media_urls.some((url) => typeof url !== 'string')) throw new GenericCollectorIngressError('content.media_urls must be an array of strings')

  return {
    source: {
      type: requireString(source.type, 'source.type')!,
      identity: requireString(source.identity, 'source.identity')!,
      reference: requireString(source.reference, 'source.reference')!,
    },
    event: { cycle: requireString(event.cycle, 'event.cycle', true), festival_year: requireNullableYear(event.festival_year, 'event.festival_year') },
    published_at: requireString(root.published_at, 'published_at', true),
    content: {
      raw_text: requireString(content.raw_text, 'content.raw_text', true),
      normalized_text: requireString(content.normalized_text, 'content.normalized_text', true),
      title: requireString(content.title, 'content.title', true),
      source_type: requireString(content.source_type, 'content.source_type')! as SourceAdapterRecord['content']['source_type'],
      media_urls: [...content.media_urls],
    },
    metadata: root.metadata as JsonObject,
    authority: { label: requireString(authority.label, 'authority.label')!, official: requireBoolean(authority.official, 'authority.official') },
    acquisition: {
      state: requireString(acquisition.state, 'acquisition.state')!,
      collected_at: requireString(acquisition.collected_at, 'acquisition.collected_at')!,
      collection_method: requireString(acquisition.collection_method, 'acquisition.collection_method')! as SourceAdapterRecord['acquisition']['collection_method'],
    },
    eligibility: { eligible: requireBoolean(eligibility.eligible, 'eligibility.eligible'), reason: requireString(eligibility.reason, 'eligibility.reason', true) },
    validation: { failure: requireString(validation.failure, 'validation.failure', true) },
  }
}

export function ingestGenericCollectorRecord<Result>(input: unknown, dispatch: SourceCollectorDispatch<Result>): Result {
  if (typeof dispatch !== 'function') throw new GenericCollectorIngressError('collector dispatch must be a function')
  const record = normalizeGenericCollectorIngressInput(input)
  return dispatch(mapSourceAdapterRecordToIngestionPayload(record))
}
