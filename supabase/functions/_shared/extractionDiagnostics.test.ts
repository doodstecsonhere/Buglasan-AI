import { describe, expect, it } from 'vitest'
import { ProviderError } from './providerErrors.ts'
import { ExtractionDiagnosticError } from './extraction.ts'
import { describeExtractionFailure, sanitizeDiagnosticText } from './extractionDiagnostics.ts'
import { generateWithFailover } from './providerFailover.ts'
import type { ProviderAdapter } from './providerAdapters.ts'

const adapter = (provider: 'gemini' | 'openai_compatible', errors: unknown[] = []): ProviderAdapter => ({ provider, model: 'test', async generate() { const error = errors.shift(); if (error) throw error; return { text: 'ok', provider, model: 'test' } } })

describe('extraction failure classification', () => {
  it('gives exhausted transient provider errors a diagnosable provider code instead of unknown_failure', () => {
    expect(describeExtractionFailure(new ProviderError('gemini', 'upstream_503', 'Gemini HTTP 503', 503), false, 'provider')).toMatchObject({ code: 'extraction_provider_upstream_503', retryable: true })
    expect(describeExtractionFailure(new ProviderError('gemini', 'rate_limited', 'x', 429), false, 'provider')).toMatchObject({ code: 'extraction_provider_rate_limited', retryable: true })
    expect(describeExtractionFailure(new ProviderError('gemini', 'timeout', 'x'), false, 'provider')).toMatchObject({ code: 'extraction_provider_timeout', retryable: true })
    expect(describeExtractionFailure(new ProviderError('gemini', 'fetch_failed', 'x'), false, 'provider')).toMatchObject({ code: 'extraction_provider_fetch_failed', retryable: true })
    expect(describeExtractionFailure(new ProviderError('gemini', 'dns_failure', 'x'), false, 'provider')).toMatchObject({ code: 'extraction_provider_dns_failure', retryable: true })
  })

  it('keeps deterministic provider outcomes permanent', () => {
    const failure = describeExtractionFailure(new ProviderError('gemini', 'authentication_rejected', 'key secret', 401), false, 'provider')
    expect(failure).toMatchObject({ code: 'extraction_nonretryable_provider', retryable: false })
    expect(failure.message).toContain('"httpStatus":401')
    expect(failure.message).not.toContain('key secret')
  })

  it('classifies malformed provider responses as non-retryable provider failures', () => {
    expect(describeExtractionFailure(new ProviderError('gemini', 'malformed_output', 'Gemini response was not JSON'), false, 'provider')).toMatchObject({ code: 'extraction_nonretryable_provider', retryable: false })
  })

  it('preserves structured diagnostics for validation failures', () => {
    const failure = describeExtractionFailure(new ProviderError('openai_compatible', 'validation_failed', 'structured extraction validation failed', undefined, 'invalid_content'), false, 'provider')
    expect(failure).toMatchObject({ code: 'extraction_invalid_content' })
    expect(JSON.stringify(failure)).not.toContain('structured extraction validation failed')
  })

  it('classifies a bare ExtractionDiagnosticError from the validation stage', () => {
    expect(describeExtractionFailure(new ExtractionDiagnosticError('invalid_structure', 'result must be an object'), false, 'validation')).toMatchObject({ code: 'extraction_invalid_structure', retryable: false })
  })

  it('separates persistence failures from provider failures and preserves retryability', () => {
    const transient = describeExtractionFailure(new Error('database 503: upstream unavailable'), false, 'persist')
    expect(transient).toMatchObject({ code: 'extraction_persistence_transient', retryable: true })
    expect(transient.message).toContain('"stage":"persistence"')
    expect(transient.message).toContain('"httpStatus":503')
    const permanent = describeExtractionFailure(new Error('database 400: bad request'), false, 'persist')
    expect(permanent).toMatchObject({ code: 'extraction_persistence_permanent', retryable: false })
  })

  it('treats a runtime error without a status at the persist stage as retryable persistence failure', () => {
    expect(describeExtractionFailure(new Error('cannot read property of undefined'), false, 'persist')).toMatchObject({ code: 'extraction_persistence_transient', retryable: true })
  })

  it('keeps a genuine provider-stage surprise as the true unknown fallback', () => {
    expect(describeExtractionFailure(new Error('boom'), false, 'provider')).toMatchObject({ code: 'extraction_unknown_failure', retryable: true })
  })

  it('handles non-Error thrown values', () => {
    expect(describeExtractionFailure('string failure', false, 'provider')).toMatchObject({ code: 'extraction_unknown_failure', retryable: true })
    expect(describeExtractionFailure({ weird: true }, false, 'persist')).toMatchObject({ code: 'extraction_persistence_transient', retryable: true })
  })

  it('classifies an aborted operation distinctly from a wall-clock timeout', () => {
    expect(describeExtractionFailure(new Error('provider operation aborted'), false, 'provider')).toMatchObject({ code: 'extraction_aborted', retryable: true })
    expect(describeExtractionFailure(new Error('anything'), true, 'provider')).toMatchObject({ code: 'extraction_timeout', retryable: true })
  })

  it('redacts secrets, urls and bearer tokens from bounded sanitized text', () => {
    const sanitized = sanitizeDiagnosticText('connect failed https://generativelanguage.googleapis.com/v1?key=SECRETKEY123 with Authorization: Bearer tok_live_abc and api_key=zzz999')
    expect(sanitized).toContain('[url]')
    expect(sanitized).toContain('bearer [redacted]')
    expect(sanitized).not.toContain('SECRETKEY123')
    expect(sanitized).not.toContain('tok_live_abc')
    expect(sanitized).not.toContain('zzz999')
    expect(sanitizeDiagnosticText('x'.repeat(5000))).toHaveLength(300)
  })
})

describe('failover context is observable through the classifier', () => {
  it('records attempts and per-attempt categories when primary fails and secondary fails permanently', async () => {
    const primary = adapter('gemini', [
      new ProviderError('gemini', 'upstream_503', 'safe'),
      new ProviderError('gemini', 'upstream_503', 'safe'),
      new ProviderError('gemini', 'upstream_503', 'safe'),
    ])
    const secondary = adapter('openai_compatible', [new ProviderError('openai_compatible', 'invalid_request', 'safe')])
    let caught: unknown
    try { await generateWithFailover({ prompt: 'x' }, primary, secondary, (text) => text, { sleep: async () => {} }) } catch (error) { caught = error }
    const failure = describeExtractionFailure(caught, false, 'provider')
    expect(failure).toMatchObject({ code: 'extraction_nonretryable_provider', retryable: false })
    expect(failure.message).toContain('"failover"')
    expect(failure.message).toContain('upstream_503')
    expect(failure.message).not.toContain('safe')
  })

  it('does not surface a failure when the secondary recovers', async () => {
    const primary = adapter('gemini', [new ProviderError('gemini', 'upstream_503', 'safe'), new ProviderError('gemini', 'upstream_503', 'safe'), new ProviderError('gemini', 'upstream_503', 'safe')])
    const secondary = adapter('openai_compatible')
    const result = await generateWithFailover({ prompt: 'x' }, primary, secondary, (text) => text, { sleep: async () => {} })
    expect(result.value).toBe('ok')
    expect(result.metadata.provider).toBe('openai_compatible')
  })
})
