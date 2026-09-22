import { describe, expect, it, vi } from 'vitest'
import { GenericCollectorIngressError, ingestGenericCollectorRecord, normalizeGenericCollectorIngressInput } from './genericCollectorIngress'
import type { SourceAdapterRecord } from './sourceAdapter'
import type { SourceIngestionPayload } from './sourceIngestion'

const valid = (): SourceAdapterRecord => ({
  source: { type: 'facebook', identity: '123_456', reference: 'https://www.facebook.com/Buglasan/posts/456' },
  event: { cycle: 'Buglasan Festival', festival_year: 2026 }, published_at: null,
  content: { raw_text: 'Program update', normalized_text: 'Program update', title: 'Update', source_type: 'text', media_urls: [] },
  metadata: { publisher: 'Buglasan Festival' }, authority: { label: 'Official', official: true },
  acquisition: { state: 'authorized_content', collected_at: '2026-09-15T12:00:00Z', collection_method: 'meta_graph_api' },
  eligibility: { eligible: true, reason: null }, validation: { failure: null },
})

describe('Phase 6 generic collector ingress', () => {
  it.each([
    ['P6-T1', 'platform', 'facebook'], ['P6-T2', 'post_id', '123_456'], ['P6-T3', 'post_url', 'https://www.facebook.com/Buglasan/posts/456'],
    ['P6-T4', 'festival_year', 2026], ['P6-T5', 'published_at', null], ['P6-T6', 'collection_method', 'meta_graph_api'],
    ['P6-T7', 'source_metadata.source_adapter.event_cycle', 'Buglasan Festival'], ['P6-T8', 'source_metadata.source_adapter.provenance', 'authorized_acquisition'],
  ] as const)('%s validates and translates %s before dispatch', (_id, field, expected) => {
    const dispatch = vi.fn<(payload: SourceIngestionPayload) => void>()
    ingestGenericCollectorRecord(valid(), dispatch)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const payload = dispatch.mock.calls[0][0]
    const value = field.split('.').reduce<unknown>((current, key) => current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, payload)
    expect(value).toEqual(expected)
  })

  it.each([
    ['non-object record', null], ['unknown root key', { ...valid(), extra: true }], ['missing source identity', { ...valid(), source: { type: 'facebook', reference: 'https://example.test' } }],
    ['invalid metadata', { ...valid(), metadata: [] }], ['invalid media URL shape', { ...valid(), content: { ...valid().content, media_urls: [3] } }],
    ['invalid festival year', { ...valid(), event: { ...valid().event, festival_year: 1800 } }], ['invalid eligibility', { ...valid(), eligibility: { ...valid().eligibility, eligible: 'yes' } }],
    ['invalid validation failure', { ...valid(), validation: { failure: false } }], ['non-JSON metadata value', { ...valid(), metadata: { x: () => undefined } }],
  ])('P6-T9..T17 rejects %s without dispatch', (_name, input) => {
    const dispatch = vi.fn<(payload: SourceIngestionPayload) => void>()
    expect(() => ingestGenericCollectorRecord(input, dispatch)).toThrow(GenericCollectorIngressError)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'REFERENCE_ONLY', state: 'reference_only' }, { name: 'EMBED_AVAILABLE', state: 'embed_available' }, { name: 'UNAVAILABLE', state: 'unavailable' },
    { name: 'failed validation', state: 'authorized_content', validation: { failure: 'bad signature' } }, { name: 'ineligible', state: 'authorized_content', eligibility: { eligible: false, reason: 'policy' } },
    { name: 'non-facebook target', state: 'authorized_content', source: { type: 'website', identity: 'x', reference: 'https://example.test/x' } },
    { name: 'javascript URL', state: 'authorized_content', source: { ...valid().source, reference: 'javascript:alert(1)' } },
    { name: 'credential URL', state: 'authorized_content', source: { ...valid().source, reference: 'https://user:pass@example.test/x' } },
  ] as const)('P6-T18..T25 rejects non-ingestible $name before dispatch', ({ state, validation, eligibility, source }) => {
    const dispatch = vi.fn<(payload: SourceIngestionPayload) => void>()
    const base = valid()
    const input = {
      ...base,
      source: source ?? base.source,
      acquisition: { ...base.acquisition, state },
      eligibility: eligibility ?? base.eligibility,
      validation: validation ?? base.validation,
    }
    expect(() => ingestGenericCollectorRecord(input, dispatch)).toThrow()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('P6-T26 preserves operator provenance, generic event cycle, null publication time, and collector-owned dispatch result', () => {
    const dispatch = vi.fn<(payload: SourceIngestionPayload) => { fingerprint: string }>(() => ({ fingerprint: 'collector-owned' }))
    const base = valid()
    const input = { ...base, acquisition: { state: 'operator_provided_content', collected_at: base.acquisition.collected_at, collection_method: 'manual' } }
    const result = ingestGenericCollectorRecord(input, dispatch)
    expect(result).toEqual({ fingerprint: 'collector-owned' })
    expect(dispatch.mock.calls[0][0]).toMatchObject({ published_at: null, festival_year: 2026, source_metadata: { source_adapter: { event_cycle: 'Buglasan Festival', provenance: 'operator_provided' } } })
  })

  it('P6-T27 does not mutate untrusted input while creating a deterministic compatibility payload', () => {
    const input = valid()
    const normalized = normalizeGenericCollectorIngressInput(input)
    normalized.content.media_urls.push('https://example.test/image.jpg')
    expect(input.content.media_urls).toEqual([])
  })
})
