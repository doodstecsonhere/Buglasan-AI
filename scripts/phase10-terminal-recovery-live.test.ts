import { describe, expect, it } from 'vitest'
import { EXCLUDED_SOURCE_ID, EXTRACTOR_VERSION, PROJECT, SOURCE_IDS, parseArgs, recover } from './phase10-terminal-recovery-live.ts'

const fingerprint = 'a'.repeat(64)
const source = { id: SOURCE_IDS[0], is_current: true, platform: 'facebook', post_id: '123', post_url: 'https://www.facebook.com/Buglasan/posts/123', status: 'active', normalized_text: 'evidence', raw_text: 'evidence', content_fingerprint: fingerprint, source_metadata: { provenance: { operator: 'reviewer', reviewed_at: '2026-09-01', capture_note: 'official post' } } }
const extraction = { id: 'extraction', source_id: SOURCE_IDS[0], source_fingerprint: fingerprint, extractor_version: EXTRACTOR_VERSION, status: 'permanent_error', attempt_count: 4, last_error_code: 'extraction_failed', claim_token: null, lease_expires_at: null }
function mockFetch(responseBody: unknown = { status: 'no_event', source_id: SOURCE_IDS[0] }, status = 200, readRows: { candidates?: unknown[]; links?: unknown[] } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (init?.method === 'POST') return new Response(JSON.stringify(responseBody), { status })
    const body = String(url).includes('/sources?') ? [source] : String(url).includes('/source_extractions?') ? [extraction]
      : String(url).includes('/events?') ? (readRows.candidates ?? []) : String(url).includes('/event_sources?') ? (readRows.links ?? []) : []
    return new Response(JSON.stringify(body))
  }) as typeof fetch
  return { request, calls }
}

describe('Phase 10 local recovery safety boundary', () => {
  it('uses only the fixed four IDs and rejects excluded/arbitrary IDs', () => {
    expect(SOURCE_IDS).toHaveLength(4)
    expect(() => parseArgs([EXCLUDED_SOURCE_ID])).toThrow('allowlist')
    expect(() => parseArgs(['not-authorized'])).toThrow('allowlist')
  })
  it('requires an operator token only for execution', async () => {
    expect(() => parseArgs([SOURCE_IDS[0]])).not.toThrow()
    const { request } = mockFetch()
    await expect(recover({ sourceId: SOURCE_IDS[0], execute: true, supabaseKey: 'key', extractionToken: 'extract', request })).rejects.toThrow('OPERATOR_TOKEN')
  })
  it('dry-runs without mutation or privileged header', async () => {
    const { request, calls } = mockFetch()
    const result = await recover({ sourceId: SOURCE_IDS[0], supabaseKey: 'key', extractionToken: 'extract', request })
    expect(result.mode).toBe('dry-run')
    expect(calls.every(({ init }) => init?.method === 'GET')).toBe(true)
    expect(calls.some(({ init }) => Object.keys(init?.headers ?? {}).some((key) => key.toLowerCase() === 'x-phase10-operator-token'))).toBe(false)
  })
  it('binds exact before-images and sends one authorized request without a client privileged flag', async () => {
    const { request, calls } = mockFetch()
    const result = await recover({ sourceId: SOURCE_IDS[0], execute: true, supabaseKey: 'key', extractionToken: 'extract', operatorToken: 'operator', request })
    expect(result.mode).toBe('execute')
    const post = calls.find(({ init }) => init?.method === 'POST')!
    expect(calls.filter(({ init }) => init?.method === 'POST')).toHaveLength(1)
    expect(post.url).toBe(`${PROJECT}/functions/v1/extract-source`)
    expect(post.init?.headers).toMatchObject({ 'x-extraction-token': 'extract', 'x-phase10-operator-token': 'operator' })
    const body = JSON.parse(String(post.init?.body))
    expect(body.source_fingerprint).toBe(fingerprint)
    expect(body.extractor_version).toBe(EXTRACTOR_VERSION)
    expect(body.source_before).toEqual(source)
    expect(body.extraction_before).toEqual(extraction)
    expect(body.privileged).toBeUndefined()
    expect(String(calls[0].url)).toContain('limit=2')
    expect(String(calls[1].url)).toContain('limit=2')
    expect(String(calls[2].url)).toContain('limit=1')
    expect(String(calls[3].url)).toContain('limit=1')
  })
  it('fails closed when a read returns a different source identity', async () => {
    const altered = mockFetch()
    altered.request = (async (url: string | URL | Request, init?: RequestInit) => {
      altered.calls.push({ url: String(url), init })
      const body = String(url).includes('/sources?') ? [{ ...source, id: SOURCE_IDS[1] }]
        : String(url).includes('/source_extractions?') ? [extraction] : []
      return new Response(JSON.stringify(body))
    }) as typeof fetch
    await expect(recover({ sourceId: SOURCE_IDS[0], execute: true, supabaseKey: 'key', extractionToken: 'extract', operatorToken: 'operator', request: altered.request })).rejects.toThrow('identity binding')
    expect(altered.calls.some(({ init }) => init?.method === 'POST')).toBe(false)
  })
  it('bounds candidate and link reads and rejects any returned association', async () => {
    const { request, calls } = mockFetch(undefined, 200, { candidates: [{ id: 'candidate' }] })
    await expect(recover({ sourceId: SOURCE_IDS[0], supabaseKey: 'key', extractionToken: 'extract', request })).rejects.toThrow('eligible')
    expect(calls.some(({ init }) => init?.method === 'POST')).toBe(false)
  })
  it('reports a post-claim non-2xx as consumed and indeterminate without body details', async () => {
    const { request, calls } = mockFetch({ provider_secret: 'must-not-leak' }, 503)
    await expect(recover({ sourceId: SOURCE_IDS[0], execute: true, supabaseKey: 'key', extractionToken: 'extract', operatorToken: 'operator', request })).rejects.toThrow('claim consumed; outcome indeterminate; no retry')
    expect(calls.filter(({ init }) => init?.method === 'POST')).toHaveLength(1)
  })
  it('stops on changed tuple, unexpected response, and never retries', async () => {
    const changed = mockFetch(); const changedSource = { ...source, content_fingerprint: 'b'.repeat(64) }
    changed.request = (async (url: string | URL | Request, init?: RequestInit) => {
      changed.calls.push({ url: String(url), init })
      return new Response(JSON.stringify(String(url).includes('/sources?') ? [changedSource] : String(url).includes('/source_extractions?') ? [extraction] : []))
    }) as typeof fetch
    await expect(recover({ sourceId: SOURCE_IDS[0], execute: true, supabaseKey: 'key', extractionToken: 'extract', operatorToken: 'operator', request: changed.request })).rejects.toThrow('eligible')
    const unexpected = mockFetch({ nope: true })
    await expect(recover({ sourceId: SOURCE_IDS[0], execute: true, supabaseKey: 'key', extractionToken: 'extract', operatorToken: 'operator', request: unexpected.request })).rejects.toThrow('unexpected')
    expect(unexpected.calls.filter(({ init }) => init?.method === 'POST')).toHaveLength(1)
  })
})
