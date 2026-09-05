import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const code = readFileSync(new URL('../supabase/functions/extract-source/index.ts', import.meta.url), 'utf8')

describe('extract-source trust and resilience boundaries', () => {
  it('authenticates with a server secret and never returns the service key', () => {
    expect(code).toContain("request.headers.get('x-extraction-token')")
    expect(code).toContain('constantTimeEqual')
    expect(code).toContain('SUPABASE_SERVICE_ROLE_KEY')
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
})
