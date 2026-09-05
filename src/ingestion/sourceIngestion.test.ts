import { describe, expect, it } from 'vitest'
import fixtures from '../../test/fixtures/source-ingestion.json'
import { SourceIngestionValidationError, normalizeSourceIngestionPayload } from './sourceIngestion'

describe('normalizeSourceIngestionPayload', () => {
  it('normalizes timestamps and overrides post_year without inferring festival_year', () => {
    const result = normalizeSourceIngestionPayload({ ...fixtures.B, post_year: 2027 })
    expect(result.published_at).toBe('2026-12-29T02:00:00.000Z')
    expect(result.post_year).toBe(2026)
    expect(result.festival_year).toBe(2027)
  })

  it.each([
    ['2027-01-01T00:30:00+08:00', 2027],
    ['2027-01-01T00:30:00+09:00', 2026],
    ['2026-12-31T16:30:00Z', 2027],
  ])('derives the Asia/Manila post year for New Year boundary %s', (publishedAt, expectedYear) => {
    const result = normalizeSourceIngestionPayload({
      ...fixtures.B,
      published_at: publishedAt,
      post_year: 2000,
      festival_year: 2030,
    })
    expect(result.post_year).toBe(expectedYear)
    expect(result.festival_year).toBe(2030)
  })

  it('tolerates a missing publication timestamp and preserves valid nullable years', () => {
    const result = normalizeSourceIngestionPayload(fixtures.C)
    expect(result.published_at).toBeNull()
    expect(result.post_year).toBe(2026)
    expect(result.festival_year).toBeNull()
  })

  it('preserves image-only null text, media order, metadata, and raw whitespace', () => {
    const image = normalizeSourceIngestionPayload(fixtures.D)
    const text = normalizeSourceIngestionPayload({ ...fixtures.A, raw_text: '  exact raw text\n' })
    expect(image.raw_text).toBeNull()
    expect(image.normalized_text).toBeNull()
    expect(image.media_urls).toEqual(fixtures.D.media_urls)
    expect(image.source_metadata).toEqual(fixtures.D.source_metadata)
    expect(text.raw_text).toBe('  exact raw text\n')
  })

  it.each([
    ['platform', { ...fixtures.A, platform: 'instagram' }],
    ['URL', { ...fixtures.A, post_url: 'javascript:alert(1)' }],
    ['timestamp', { ...fixtures.A, collected_at: 'September 5' }],
    ['year', { ...fixtures.A, festival_year: 2200 }],
    ['array', { ...fixtures.A, media_urls: 'https://example.test/a.jpg' }],
    ['metadata', { ...fixtures.A, source_metadata: [] }],
    ['unknown field', { ...fixtures.A, status: 'active' }],
  ])('rejects invalid %s input', (_name, payload) => {
    expect(() => normalizeSourceIngestionPayload(payload)).toThrow(SourceIngestionValidationError)
  })

  it('rejects text-free records without media or metadata provenance', () => {
    expect(() => normalizeSourceIngestionPayload({
      ...fixtures.D,
      source_type: 'unknown',
      media_urls: [],
      source_metadata: {},
    })).toThrow(/text-null records/)
  })
})
