import { describe, expect, it } from 'vitest'
import { parseArguments, parseManifestText, validateManifest, validateManifestRecord } from './phase10-manifest-intake.ts'

const base = {
  platform: 'facebook', post_id: '123456789', post_url: 'https://www.facebook.com/Buglasan/posts/123456789',
  published_at: null, post_year: null, festival_year: null, raw_text: null, normalized_text: null, title: 'Synthetic image-only fixture', source_type: 'image',
  media_urls: ['https://cdn.example.invalid/synthetic-2026-001.jpg'], collected_at: '2026-01-02T03:04:05Z', collection_method: 'manual', source_metadata: { fixture: 'synthetic-only' },
  provenance: { operator: 'fixture-operator', reviewed_at: '2026-01-02T03:04:05Z', capture_note: 'Synthetic test input; not real 2026 data' },
}

describe('Phase 10 manifest intake', () => {
  it('accepts official, image-only input and preserves explicit nulls', () => {
    const result = validateManifestRecord(base)
    expect(result.raw_text).toBeNull(); expect(result.media_urls).toHaveLength(1); expect(result.source_metadata.provenance).toEqual(base.provenance)
  })
  it('rejects untrusted URLs, unknown fields, and missing provenance', () => {
    expect(() => validateManifestRecord({ ...base, post_url: 'https://www.facebook.com/Other/posts/x' })).toThrow(/trusted/)
    expect(() => validateManifestRecord({ ...base, extra: true })).toThrow(/unknown field/)
    expect(() => validateManifestRecord({ ...base, provenance: undefined })).toThrow(/provenance/)
  })
  it('rejects duplicate stable IDs and parses JSONL', () => {
    const report = validateManifest([{ ...base }, { ...base }])
    expect(report.counts).toMatchObject({ total: 2, valid: 1, invalid: 0, duplicate: 1 })
    expect(report.diagnostics[0].reasons[0]).toMatch(/duplicate/)
    expect(parseManifestText(`${JSON.stringify(base)}\n\n${JSON.stringify({ ...base, post_id: '123456790', post_url: 'https://www.facebook.com/Buglasan/posts/123456790' })}`, 'jsonl')).toHaveLength(2)
  })
  it('rejects multiple paths and ignores shell punctuation', () => {
    expect(parseArguments(['--validate', 'manifest.json;', ';'])).toEqual({ file: 'manifest.json', mode: 'validate' })
    expect(() => parseArguments(['--validate', 'a.json', 'b.json'])).toThrow(/exactly one positional/)
  })
  it('reports all invalid records and useful classifications', () => {
    const report = validateManifest([base, { ...base, post_id: 'bad', post_url: 'https://example.invalid/not-official' }, { ...base, post_id: '123456790', post_url: 'https://www.facebook.com/Buglasan/posts/123456790', raw_text: 'text', normalized_text: 'text', festival_year: 2026 }])
    expect(report.counts).toMatchObject({ total: 3, valid: 2, invalid: 1, text_bearing: 1, image_only: 1, festival_year_known: 1, festival_year_null: 1 })
    expect(report.diagnostics[0].reasons.join(' ')).toMatch(/trusted/)
  })
  it('accepts only direct numeric IDs or non-empty slugs ending in the matching numeric ID', () => {
    for (const postUrl of [
      'https://www.facebook.com/Buglasan/posts/123456789/',
      'https://www.facebook.com/Buglasan/posts/some-slug/123456789',
      'https://www.facebook.com/Buglasan/posts/caf%C3%A9/123456789/',
    ]) expect(() => validateManifestRecord({ ...base, post_url: postUrl })).not.toThrow()
  })
  it.each([
    'http://www.facebook.com/Buglasan/posts/123456789',
    'https://facebook.com/Buglasan/posts/123456789',
    'https://www.facebook.com/Buglasan/videos/123456789',
    'https://www.facebook.com/Buglasan/posts/',
    'https://www.facebook.com/Buglasan/posts/slug/',
    'https://www.facebook.com/Buglasan/posts/slug/123456789/extra',
    'https://www.facebook.com/Buglasan/posts/slug/123456788',
    'https://www.facebook.com/Buglasan/posts/slug/123456789?ref=share',
    'https://user:pass@www.facebook.com/Buglasan/posts/123456789',
    'https://www.facebook.com/Buglasan/posts//123456789',
  ])('rejects invalid trusted URL form %s', (postUrl) => {
    expect(() => validateManifestRecord({ ...base, post_url: postUrl })).toThrow()
  })
})
