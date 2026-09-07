import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAuthorizedDiagnosticRequest } from '../supabase/functions/chat/authorization.ts'

const originalDeno = (globalThis as Record<string, unknown>).Deno

function setConfiguredSecret(value: string | undefined): void {
  ;(globalThis as Record<string, unknown>).Deno = { env: { get: vi.fn(() => value) } }
}

function request(header?: string): Request {
  return new Request('https://example.test/functions/v1/chat', header === undefined ? undefined : {
    headers: { 'x-chat-diagnostic-token': header },
  })
}

afterEach(() => {
  if (originalDeno === undefined) delete (globalThis as Record<string, unknown>).Deno
  else (globalThis as Record<string, unknown>).Deno = originalDeno
})

describe('isAuthorizedDiagnosticRequest', () => {
  it.each([
    ['missing configured secret', undefined, 'diagnostic-secret', false],
    ['empty configured secret', '', 'diagnostic-secret', false],
    ['whitespace configured secret', '   ', 'diagnostic-secret', false],
    ['missing header', 'diagnostic-secret', undefined, false],
    ['empty header', 'diagnostic-secret', '', false],
    ['whitespace header', 'diagnostic-secret', '   ', false],
    ['wrong header', 'diagnostic-secret', 'other-secret', false],
    ['prefix plus secret', 'diagnostic-secret', 'Bearer diagnostic-secret', false],
    ['suffix plus secret', 'diagnostic-secret', 'diagnostic-secret-extra', false],
    ['case mismatch', 'Diagnostic-Secret', 'diagnostic-secret', false],
    ['slash suffix mismatch', 'diagnostic-secret', 'diagnostic-secret/extra', false],
    ['different punctuation mismatch', 'diagnostic-secret', 'diagnostic_secret', false],
    ['empty request header collection', 'diagnostic-secret', undefined, false],
    ['configured secret with internal whitespace', 'diagnostic secret', 'diagnostic-secret', false],
    ['exact configured secret', 'diagnostic-secret', 'diagnostic-secret', true],
  ])('%s', (_name, configured, supplied, expected) => {
    setConfiguredSecret(configured)
    expect(isAuthorizedDiagnosticRequest(request(supplied))).toBe(expected)
  })

  it('reads only the dedicated server-side secret and header', () => {
    const get = vi.fn((name: string) => name === 'CHAT_DIAGNOSTIC_TOKEN' ? 'diagnostic-secret' : 'legacy-secret')
    ;(globalThis as Record<string, unknown>).Deno = { env: { get } }

    expect(isAuthorizedDiagnosticRequest(request('diagnostic-secret'))).toBe(true)
    expect(get).toHaveBeenCalledWith('CHAT_DIAGNOSTIC_TOKEN')
    expect(get).toHaveBeenCalledTimes(1)
  })
})
