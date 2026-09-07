import { describe, expect, it } from 'vitest'
import { classifyGenerationMessage, getGenerationFailure } from '../supabase/functions/chat/generationDiagnostics.ts'

describe('generation diagnostics', () => {
  it('returns only safe categorized metadata for an authorized generation failure', () => {
    const result = getGenerationFailure(Object.assign(new Error('fetch failed: secret prompt evidence'), {
      name: 'GoogleGenerativeAIError', code: 'UNAVAILABLE', status: 503, retryable: true,
      cause: { name: 'TypeError', message: 'secret' }, stack: 'secret stack', response: { body: 'secret body' },
    }))
    expect(result).toEqual({ stage: 'answer_generation', errorName: 'GoogleGenerativeAIError', errorCode: 'UNAVAILABLE', httpStatus: 503, retryable: true, causeName: 'TypeError', transportKind: 'provider_http', messageCategory: 'upstream_503' })
    expect(JSON.stringify(result)).not.toMatch(/secret|stack|prompt|evidence|body/i)
  })

  it.each([
    ['fetch failed', 'fetch_failed'], ['DNS lookup failed', 'dns_failure'], ['ECONNRESET', 'connection_reset'],
    ['ECONNREFUSED', 'connection_failure'], ['request timed out', 'timeout'], ['429 quota exceeded', 'rate_limited'],
    ['upstream 500', 'upstream_500'], ['upstream 502', 'upstream_502'], ['upstream 503', 'upstream_503'],
    ['upstream 504', 'upstream_504'], ['API key rejected', 'authentication_rejected'], ['permission denied', 'permission_denied'],
    ['model not found', 'model_not_found'], ['invalid request', 'invalid_request'],
  ])('maps %s to %s', (message, category) => expect(classifyGenerationMessage(message).category).toBe(category))

  it('preserves only numeric HTTP status and never serializes nested data or raw messages', () => {
    const result = getGenerationFailure({ name: 'Error', statusCode: 502, message: 'raw prompt and provider body', cause: { name: 'Error', secret: 'x' }, stack: 'stack' })
    expect(result.httpStatus).toBe(502)
    expect(result).not.toHaveProperty('message')
    expect(result).not.toHaveProperty('stack')
    expect(result).not.toHaveProperty('cause')
    expect(JSON.stringify(result)).not.toMatch(/raw prompt|provider body|secret|stack/i)
  })
})
