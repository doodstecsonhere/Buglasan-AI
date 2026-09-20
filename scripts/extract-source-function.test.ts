import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { parseModelJson, validateExtractionResult } from '../supabase/functions/_shared/extraction.ts'
import { ProviderError, classifyHttpStatus, classifyTransport, safeProviderError } from '../supabase/functions/_shared/providerErrors.ts'
import { extractWithFailover } from '../supabase/functions/_shared/providerExtraction.ts'
import { describeExtractionFailure } from '../supabase/functions/_shared/extractionDiagnostics.ts'
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
    expect(code).toContain("?? 'phase6-v2'")
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

  it('selects the exact pipeline 2027 canonical fixture before any provider call when the pipeline token is supplied', () => {
    const fixtureStart = code.indexOf("'pipeline-test-10-canonical':")
    const fixtureEnd = code.indexOf("'pipeline-test-batch-a':", fixtureStart)
    const fixture = code.slice(fixtureStart, fixtureEnd)
    const selection = code.slice(code.indexOf('function acceptanceFixture'), code.indexOf('async function callGemini'))

    expect(fixture).toContain("festival_year: 2027")
    expect(fixture).toContain("event_name: 'Buglasan Pipeline Canonical 2027'")
    expect(selection).toContain("request.headers.get('x-pipeline-acceptance-fixture-token')")
    expect(selection).toContain("postId.startsWith('pipeline-test-')")
    expect(selection).toContain('if (fixture?.source === sourceText) return fixture.result')
    expect(code.indexOf('acceptanceFixture(source.post_id, sourceText, request) ?? await callGemini')).toBeGreaterThan(code.indexOf('function acceptanceFixture'))
  })

  it('has an operator-only Phase 10 path bound to the exact approved claim contract', () => {
    expect(code).toContain("Deno.env.get('PHASE10_OPERATOR_TOKEN') ?? ''")
    expect(code).toContain("request.headers.get('x-phase10-operator-token')")
    expect(code).toContain('p_source_before: body.source_before')
    expect(code).toContain('p_extraction_before: extractionBefore')
    expect(code).toContain("rpc/claim_phase10_terminal_retry")
    expect(code).toContain('body.source_fingerprint')
    expect(code).toContain('body.extractor_version !== EXTRACTOR_VERSION')
    expect(code).toContain('validOperatorMetadata(body.operator_metadata)')
    expect(code).toContain('!privileged && RECONCILE_AFTER_EXTRACTION')
    expect(code).toContain("'phase10_claim_rejected'")
  })

  it('keeps the privileged path bounded and free of provider/raw diagnostic output', () => {
    expect(code).toContain("'phase10_source_binding_failed'")
    expect(code).toContain("'invalid_phase10_request'")
    expect(code).not.toMatch(/return response\([^\n]*error\.message/)
    expect(code).not.toMatch(/return response\([^\n]*JSON\.stringify\(error/)
    expect(code).toContain("p_error_message: failure.message")
  })
  it('does not add prohibited processing paths', () => {
    expect(code).not.toMatch(/source_chunks|embedding|\bOCR\b/i)
    expect(code).toContain('Do not use external knowledge')
    expect(code).toContain('Never return reasoning or chain-of-thought')
  })

  it('includes subject scope guidance in extraction prompt', () => {
    expect(code).toContain('SUBJECT SCOPE')
    expect(code).toContain('specific child or sub-event')
    expect(code).toContain('Do not generalize a sub-event venue/date/status change to the entire festival')
  })

  it('includes subject scope preservation fixture for Buglas Camp Fest', () => {
    expect(code).toContain('subject-scope-test-buglas-camp-fest')
    expect(code).toContain('Buglas Camp Fest 2026')
    expect(code).toContain('Dons Magna, Dauin, Negros Oriental')
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

  it('keeps an exhausted transient provider failure retryable', () => {
    expect(code).toContain('describeExtractionFailure(error, controller.signal.aborted, stage)')
    expect(code).toContain("failure.retryable ? 'retryable_error' : 'permanent_error'")
    // Behavioral guarantee lives in the shared classifier: exhausted transient
    // provider categories remain retryable rather than collapsing to a permanent failure.
    expect(describeExtractionFailure(new ProviderError('gemini', 'upstream_503', 'raw upstream', 503), false, 'provider').retryable).toBe(true)
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

  it('bounds each provider attempt so a hanging primary cannot consume the whole extraction budget', () => {
    // The 90s wall alone previously prevented secondary failover from engaging
    // within budget (Bundle 36 production extraction_timeout, attempt 2).
    expect(code).toContain('const PROVIDER_ATTEMPT_TIMEOUT_MS = 25_000')
    const callGemini = code.slice(code.indexOf('async function callGemini'), code.indexOf('serve(async (request)'))
    expect(callGemini).toContain('attemptTimeoutMs: PROVIDER_ATTEMPT_TIMEOUT_MS')
    // The shared wall and its retryable classification remain untouched.
    expect(code).toContain('const EXTRACTION_TIMEOUT_MS = 90_000')
    expect(describeExtractionFailure(new Error('anything'), true, 'provider')).toMatchObject({ code: 'extraction_timeout', retryable: true })
  })

  describe('bounded-attempt recovery through the shared failover boundary', () => {
    // queueMicrotask must stay real so promise rejection bookkeeping is not deferred.
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
    afterEach(() => { vi.useRealTimers() })

    it('abandons a never-settling primary at the attempt timeout and fails over to the secondary', async () => {
      const hangingPrimary: ProviderAdapter = { provider: 'gemini', model: 'test', generate: () => new Promise(() => {}) }
      const secondary: ProviderAdapter = { provider: 'openai_compatible', model: 'test', generate: async () => ({ text: JSON.stringify({ candidates: [], source_summary: null }), provider: 'openai_compatible', model: 'test' }) }
      const pending = extractWithFailover(source, 'prompt', hangingPrimary, secondary, { maxPrimary: 1, maxSecondary: 1, attemptTimeoutMs: 25_000 })
      await vi.advanceTimersByTimeAsync(25_000)
      const result = await pending
      expect(result.metadata.provider).toBe('openai_compatible')
      expect(result.value.candidates).toEqual([])
    })

    it('exhausts bounded primary hangs into a retryable provider timeout instead of relying on the wall abort', async () => {
      const hangingPrimary: ProviderAdapter = { provider: 'gemini', model: 'test', generate: () => new Promise(() => {}) }
      const pending = extractWithFailover(source, 'prompt', hangingPrimary, undefined, { maxPrimary: 3, maxSecondary: 2, attemptTimeoutMs: 25_000 })
      const expectedError = pending.then(() => null, (caught: unknown) => caught)
      // Three bounded attempt timeouts fire inside the 90s wall; without the bound
      // this scenario could only ever end in the wall abort itself.
      await vi.advanceTimersByTimeAsync(50_000)
      await vi.advanceTimersByTimeAsync(25_000)
      const error = await expectedError
      expect(error).toBeInstanceOf(Error)
      expect((error as Error & { category?: string }).category).toBe('timeout')
      const failure = describeExtractionFailure(error, false, 'provider')
      expect(failure).toMatchObject({ code: 'extraction_provider_timeout', retryable: true })
      expect((error as Error & { failoverFailures?: string[] }).failoverFailures).toEqual(['timeout', 'timeout', 'timeout'])
    })
  })
})
