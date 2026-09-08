import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseModelJson, validateExtractionResult } from '../supabase/functions/_shared/extraction.ts'
import { ProviderError, classifyHttpStatus, classifyTransport, safeProviderError } from '../supabase/functions/_shared/providerErrors.ts'
import { extractWithFailover } from '../supabase/functions/_shared/providerExtraction.ts'
import type { ProviderAdapter } from '../supabase/functions/_shared/providerAdapters.ts'

const code = readFileSync(new URL('../supabase/functions/extract-source/index.ts', import.meta.url), 'utf8')
const source = 'Buglasan Dance Showdown is confirmed on October 18, 2027 at 6:00 PM at Freedom Park. Admission is FREE.'
const candidate = {
  event_name: 'Buglasan Dance Showdown', aliases: [], description: null, category: 'competition',
  start_datetime: '2027-10-18T18:00:00+08:00', end_datetime: null, venue: 'Freedom Park', organizer: null,
  deadline: null, eligibility: null, fee_kind: 'free', fees: 'FREE', contact_info: null,
  status: 'confirmed', festival_year: 2027,
  evidence: [
    { field: 'event_name', excerpt: 'Buglasan Dance Showdown' }, { field: 'category', excerpt: 'Dance Showdown' },
    { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' },
    { field: 'fee_kind', excerpt: 'FREE' }, { field: 'fees', excerpt: 'FREE' }, { field: 'status', excerpt: 'confirmed' },
    { field: 'festival_year', excerpt: '2027' },
  ], review_reasons: [],
}
const adapter = (provider: 'gemini' | 'openai_compatible', errors: unknown[] = []): ProviderAdapter => ({
  provider, model: 'test', async generate() {
    const error = errors.shift(); if (error) throw error
    return { text: 'ok', provider, model: 'test' }
  },
})

describe('extract-source trust and resilience boundaries', () => {
  it('authenticates with a server secret and never returns the service key', () => {
    expect(code).toContain("request.headers.get('x-extraction-token')")
    expect(code).toContain('constantTimeEqual')
    expect(code).toContain('SUPABASE_SECRET_KEYS')
    expect(code).toContain("secretKeys['default']")
    expect(code).not.toMatch(/response\([^\n]*SERVICE_KEY/)
  })
  it('owns bounded retries for 429/503/timeouts and emits compact statuses', () => {
    expect(code).toContain('MAX_ATTEMPTS = 3')
    expect(code).toContain('429, 500, 502, 503, 504')
    expect(code).toContain('error instanceof TypeError')
    expect(code).toContain('error instanceof TransientExtractionError')
    expect(code).not.toMatch(/\/429\|500\|502\|503\|504/)
    expect(code).toContain('controller.abort()')
    expect(code).toContain("'retryable_error'")
    expect(code).toContain('p_claim_token: claimToken')
    expect(code).toContain("claim.claim_token !== claimToken")
  })
  it('uses a currently supported model default and logs only sanitized upstream metadata', () => {
    expect(code).toContain("'gemini-flash-latest'")
    expect(code).toContain('safeGeminiErrorMetadata')
    expect(code).toContain("request_id: result.headers.get('x-goog-request-id')")
    expect(code).not.toMatch(/console\.(?:log|error)\([^\n]*(?:GEMINI_API_KEY|SERVICE_KEY|TRUSTED_TOKEN)/)
  })
  it('keeps deterministic acceptance fixtures disabled and doubly gated', () => {
    expect(code).toContain("Deno.env.get('EXTRACTION_ACCEPTANCE_FIXTURE_TOKEN') ?? ''")
    expect(code).toContain("request.headers.get('x-acceptance-fixture-token')")
    expect(code).toContain('constantTimeEqual(ACCEPTANCE_FIXTURE_TOKEN, TRUSTED_TOKEN)')
    expect(code).toContain("postId.startsWith('extraction-test-')")
    expect(code).toContain("postId.startsWith('reconciliation-test-')")
    expect(code).toContain('fixture.source !== sourceText')
    expect(code).not.toMatch(/body\.(?:result|payload|extraction|candidates)/)
  })
  it('does not add prohibited processing paths', () => {
    expect(code).not.toMatch(/source_chunks|embedding|\bOCR\b/i)
    expect(code).toContain('Do not use external knowledge')
    expect(code).toContain('Never return reasoning or chain-of-thought')
  })

  it('does not compile date-only fixture evidence into invented midnight timestamps', () => {
    expect(code).not.toMatch(/start_datetime:\s*'[^']*T00:00:00[+]08:00'/)
  })

  it.each([
    ['malformed JSON', () => parseModelJson('{bad'), 'malformed_json'],
    ['invalid root shape', () => validateExtractionResult([], source), 'invalid_structure'],
    ['invalid candidate shape', () => validateExtractionResult({ candidates: [{}], source_summary: null }, source), 'invalid_structure'],
    ['evidence excerpt mismatch', () => validateExtractionResult({ candidates: [{ ...candidate, evidence: [{ field: 'event_name', excerpt: 'Invented' }] }], source_summary: null }, source), 'invalid_content'],
    ['invalid timestamp timezone', () => validateExtractionResult({ candidates: [{ ...candidate, start_datetime: '2027-10-18T18:00:00' }], source_summary: null }, source), 'invalid_content'],
    ['invalid enum', () => validateExtractionResult({ candidates: [{ ...candidate, category: 'party' }], source_summary: null }, source), 'invalid_content'],
  ])('reports the safe diagnostic for %s', (_label, operation, diagnostic) => {
    expect(operation).toThrow(expect.objectContaining({ diagnostic }))
  })

  it('suppresses raw provider messages and uses the unknown fallback for unclassified errors', () => {
    const safe = safeProviderError(new ProviderError('gemini', 'validation_failed', 'raw secret response and api-key', undefined, 'invalid_content'))
    expect(safe).toEqual({ provider: 'gemini', category: 'validation_failed', httpStatus: undefined, diagnostic: 'invalid_content' })
    expect(JSON.stringify(safe)).not.toContain('raw secret response')
    expect(safeProviderError(new Error('raw unclassified provider body'))).toEqual({ category: 'unknown_provider_error' })
  })

  it.each([[429, 'rate_limited'], [500, 'upstream_500'], [502, 'upstream_502'], [503, 'upstream_503'], [504, 'upstream_504']] as const)('keeps HTTP classification %s unchanged', (status, category) => expect(classifyHttpStatus(status)).toBe(category))
  it.each([['timeout', 'timeout'], ['dns failure', 'dns_failure'], ['connection reset', 'connection_reset'], ['connection refused', 'connection_failure'], ['unexpected transport error', 'fetch_failed']] as const)('keeps transport classification for %s unchanged', (message, category) => expect(classifyTransport(new Error(message))).toBe(category))

  it('keeps transient retry/failover behavior unchanged', async () => {
    let secondaryCalls = 0
    const secondary = { ...adapter('openai_compatible'), generate: async () => { secondaryCalls++; return { text: JSON.stringify({ candidates: [], source_summary: null }), provider: 'openai_compatible' as const, model: 'test' } } }
    const result = await extractWithFailover(source, 'prompt', adapter('gemini', [new ProviderError('gemini', 'upstream_503', 'raw upstream')]), secondary, { maxPrimary: 1 })
    expect(result.value.candidates).toEqual([])
    expect(secondaryCalls).toBe(1)
  })
})
