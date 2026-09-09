import { describe, expect, it } from 'vitest'
import { inspectManifest, parseArguments, AUGUST_23_POST_ID } from './phase10-corpus-inspect.ts'

const manifest = [{
  platform: 'facebook', post_id: AUGUST_23_POST_ID, post_url: `https://www.facebook.com/Buglasan/posts/${AUGUST_23_POST_ID}`,
  published_at: '2026-08-23T08:00:00+08:00', post_year: 2026, festival_year: 2026,
  raw_text: 'August 23 official post', normalized_text: 'August 23 official post', title: 'August 23', source_type: 'text', media_urls: [],
  collected_at: '2026-09-01T00:00:00Z', collection_method: 'manual', source_metadata: { provenance: { operator: 'reviewer', reviewed_at: '2026-09-01', capture_note: 'official' } },
  provenance: { operator: 'reviewer', reviewed_at: '2026-09-01', capture_note: 'official' },
}]
const source = { id: '00000000-0000-0000-0000-000000000001', platform: 'facebook', post_id: AUGUST_23_POST_ID, post_url: manifest[0].post_url, is_current: true, status: 'active', collection_method: 'manual', post_year: 2026, festival_year: 2026, raw_text: manifest[0].raw_text, normalized_text: manifest[0].normalized_text, source_metadata: { provenance: { operator: 'reviewer', reviewed_at: '2026-09-01', capture_note: 'official' } } }

function mockFetch(rows: Record<string, unknown>[], calls: string[]) {
  return async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method}:${url}`)
    if (url.includes('/sources?')) return Response.json(rows)
    if (url.includes('source_chunks')) return Response.json([{ id: 'chunk', source_id: source.id, chunk_index: 0, content: 'August 23', is_current: true }])
    return Response.json([])
  }
}

describe('Phase 10 exact-ten corpus inspector', () => {
  it('resolves the manifest identity, reads stored evidence, and stays GET-only', async () => {
    const calls: string[] = []
    const report = await inspectManifest(manifest, { url: 'https://example.supabase.co', key: 'secret', request: mockFetch([source], calls) })
    expect(report.resolved_records).toBe(1)
    expect(report.evidence_check).toMatchObject({ post_id: AUGUST_23_POST_ID, matched: true, stored_source_or_chunk_text_only: true })
    expect(calls.every((call) => call.startsWith('GET:'))).toBe(true)
    expect(JSON.stringify(report)).not.toContain('secret')
  })
  it.each([
    ['missing', []],
    ['duplicate', [source, source]],
    ['mismatched URL', [{ ...source, post_url: 'https://www.facebook.com/Buglasan/posts/other' }]],
    ['out of manifest', [source, { ...source, id: '00000000-0000-0000-0000-000000000002', post_id: '999999999', post_url: 'https://www.facebook.com/Buglasan/posts/999999999' }]],
  ])('fails closed on %s sources', async (_name, rows) => {
    await expect(inspectManifest(manifest, { url: 'https://example.supabase.co', key: 'secret', request: mockFetch(rows, []) })).rejects.toThrow()
  })
  it('detects a same-post duplicate even when its URL differs', async () => {
    await expect(inspectManifest(manifest, { url: 'https://example.supabase.co', key: 'secret', request: mockFetch([source, { ...source, id: '00000000-0000-0000-0000-000000000002', post_url: 'https://www.facebook.com/Buglasan/posts/other' }], []) })).rejects.toThrow(/duplicated/)
  })
  it('rejects ineligible provenance and collection method', async () => {
    await expect(inspectManifest(manifest, { url: 'https://example.supabase.co', key: 'secret', request: mockFetch([{ ...source, collection_method: 'scrape', source_metadata: {} }], []) })).rejects.toThrow()
  })
  it('does not match August 23 from metadata or URL', async () => {
    const noEvidence = { ...source, raw_text: 'unrelated', normalized_text: 'unrelated', source_metadata: { provenance: { operator: 'reviewer', reviewed_at: '2026-09-01', capture_note: 'official' }, note: 'August 23' } }
    const evidenceManifest = { ...manifest[0], source_metadata: { provenance: { operator: 'reviewer', reviewed_at: '2026-09-01', capture_note: 'August 23' } } }
    const calls: string[] = []
    const request = mockFetch([noEvidence], calls)
    await expect(inspectManifest([evidenceManifest], { url: 'https://example.supabase.co', key: 'secret', request: async (url, init) => url.includes('source_chunks') ? Response.json([{ id: 'chunk', content: 'unrelated', is_current: true }]) : request(url, init) })).resolves.toMatchObject({ evidence_check: { matched: false } })
  })
  it('fails closed on malformed chunk data', async () => {
    const request = mockFetch([source], [])
    await expect(inspectManifest(manifest, { url: 'https://example.supabase.co', key: 'secret', request: async (url, init) => url.includes('source_chunks') ? Response.json([{ is_current: true }]) : request(url, init) })).rejects.toThrow(/content/)
  })
  it('bounds source output and argument shape', async () => {
    await expect(inspectManifest(manifest, { url: 'https://example.supabase.co', key: 'secret', maxRows: 0, request: mockFetch([source], []) })).rejects.toThrow(/positive integer/)
    await expect(inspectManifest(manifest, { url: 'https://example.supabase.co', key: 'secret', maxRows: 1.5, request: mockFetch([source], []) })).rejects.toThrow(/positive integer/)
    expect(parseArguments(['manifest.json;'])).toBe('manifest.json')
    expect(() => parseArguments([])).toThrow(/usage/)
  })
})
