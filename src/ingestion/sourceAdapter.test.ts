import { describe, expect, it } from 'vitest'
import {
  adaptToSourceIngestionPayload,
  mapSourceAdapterRecordToIngestionPayload,
  type EventSourceAdapter,
  type SourceAdapterRecord,
} from './sourceAdapter'

const record = (overrides: Partial<SourceAdapterRecord> = {}): SourceAdapterRecord => ({
  source: { type: 'facebook', identity: '123_456', reference: 'https://www.facebook.com/Buglasan/posts/456' },
  event: { cycle: 'Buglasan Festival', festival_year: 2026 },
  published_at: null,
  content: { raw_text: 'Program update', normalized_text: 'Program update', title: 'Update', source_type: 'text', media_urls: [] },
  metadata: { publisher: 'Buglasan Festival' },
  authority: { label: 'Official', official: true },
  acquisition: { state: 'authorized_content', collected_at: '2026-09-15T12:00:00Z', collection_method: 'meta_graph_api' },
  eligibility: { eligible: true, reason: null },
  validation: { failure: null },
  ...overrides,
})

describe('Phase 5 generic event source adapter boundary', () => {
  it('P5-T1..T8 maps explicit identity, event year, unknown publication time, content, authority, and provenance without changing physical names', () => {
    const payload = mapSourceAdapterRecordToIngestionPayload(record())
    expect(payload).toMatchObject({ platform: 'facebook', post_id: '123_456', post_url: 'https://www.facebook.com/Buglasan/posts/456', festival_year: 2026, published_at: null })
    expect(payload.source_metadata).toMatchObject({ source_adapter: { event_cycle: 'Buglasan Festival', authority_label: 'Official', acquisition_state: 'authorized_content', provenance: 'authorized_acquisition' } })
  })

  it.each(['reference_only', 'embed_available'] as const)('P5-T9..T10 does not treat Facebook %s as authorization or ingestibility', (state) => {
    expect(() => mapSourceAdapterRecordToIngestionPayload(record({ acquisition: { ...record().acquisition, state } }))).toThrow(/not authorized or ingestible/)
  })

  it('P5-T11..T14 preserves operator-provided provenance distinctly from acquired Facebook content', () => {
    const payload = mapSourceAdapterRecordToIngestionPayload(record({ acquisition: { state: 'operator_provided_content', collected_at: '2026-09-15T12:00:00Z', collection_method: 'manual' } }))
    expect(payload.collection_method).toBe('manual')
    expect(payload.source_metadata).toMatchObject({ source_adapter: { acquisition_state: 'operator_provided_content', provenance: 'operator_provided' } })
  })

  it.each([
    ['unavailable', record({ acquisition: { ...record().acquisition, state: 'unavailable' } })],
    ['validation failure', record({ validation: { failure: 'signature mismatch' } })],
    ['ineligible', record({ eligibility: { eligible: false, reason: 'outside policy' } })],
    ['unsafe required URL scheme', record({ source: { ...record().source, reference: 'javascript:alert(1)' } })],
  ])('P5-T15..T18 rejects %s deterministically', (_name, input) => {
    expect(() => mapSourceAdapterRecordToIngestionPayload(input)).toThrow()
  })

  it('P5-T19..T22 permits a synthetic non-Buglasan Facebook adapter but registers no production source selection path', () => {
    const harborAdapter: EventSourceAdapter<{ id: string }> = {
      id: 'harbor-days-facebook-v1',
      adapt: ({ id }) => record({ source: { type: 'facebook', identity: id, reference: `https://www.facebook.com/HarborDays/posts/${id}` }, event: { cycle: 'Harbor Days', festival_year: 2031 } }),
    }
    const payload = adaptToSourceIngestionPayload(harborAdapter, { id: 'a1' })
    expect(payload).toMatchObject({ post_id: 'a1', festival_year: 2031 })
    expect(JSON.stringify(harborAdapter)).not.toContain('Buglasan')
  })

  it('has no generic collector target until one is explicitly selected', () => {
    expect(() => mapSourceAdapterRecordToIngestionPayload(record({ source: { type: 'website', identity: 'bulletin-1', reference: 'https://example.test/bulletin-1' } }))).toThrow(/No collector target/)
  })
})
