import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAuthorizedDiagnosticRequest } from '../supabase/functions/chat/authorization.ts'
import { readFileSync } from 'node:fs'

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

describe('chat diagnostic contract', () => {
  const chat = readFileSync('supabase/functions/chat/index.ts', 'utf8')
  const client = readFileSync('src/services/chatService.ts', 'utf8')
  const live = readFileSync('scripts/orchestration-live.ts', 'utf8')

  it('treats an unauthorized diagnostic marker as ordinary chat', () => {
    expect(chat).toContain('body.diagnostic === true')
    expect(chat).toContain('isAuthorizedDiagnosticRequest(req)')
    expect(chat).not.toContain("status: 401")
    expect(chat).toContain('diagnosticAuthorized = diagnosticRequested && isAuthorizedDiagnosticRequest(req)')
    expect(chat).not.toContain('diagnosticRequested && !diagnosticAuthorized')
    expect(chat).toContain('const diagnostic = diagnosticAuthorized ? createDiagnosticReport() : undefined')
  })

  it('keeps diagnostic output restricted to authorized requests and captures rejected RPCs safely', () => {
    expect(chat).toContain('diagnostics: diagnostic')
    expect(chat).toContain('.catch((error: unknown)')
    expect(chat).toContain('getSafeRpcErrorMetadata')
    expect(chat).toContain("return { data: [], error: getSafeRpcErrorMetadata(error) }")
    expect(chat).toContain("typeof record.message === 'string'")
    expect(chat).toContain("typeof record[key] === 'string'")
    expect(chat).toContain("if (result?.error) rpc.error = getSafeRpcErrorMetadata(result.error)")
    expect(chat).not.toContain("matchThreshold: CONTEXT_LIMITS.chunkMatchThreshold")
    expect(chat).not.toContain('diagnosticToken')
    expect(chat).not.toContain('suppliedSecret')
  })

  it('keeps the retrieval contract and frontend unchanged', () => {
    expect(chat).toContain("generateQueryEmbedding(query, { apiKey: GEMINI_API_KEY, model: GEMINI_EMBEDDING_MODEL })")
    expect(chat).toContain("supabase.rpc('search_source_chunks'")
    expect(chat).toContain("supabase.rpc('get_festival_events'")
    expect(chat).toContain('match_threshold: CONTEXT_LIMITS.chunkMatchThreshold')
    expect(live).toContain("diagnostic: true")
    expect(live).toContain('process.env.CHAT_DIAGNOSTIC_TOKEN')
    expect(live).toContain('|| !chatDiagnosticToken')
    expect(client).not.toContain('diagnostic')
  })

  it('uses the exact guarded generation diagnostic payload', () => {
    expect(live).toContain("message: 'When is Buglasan Festival 2026?'")
    expect(live).toContain('festivalYear: 2026')
    expect(live).toContain("language: 'en'")
    expect(live).toContain('diagnostic: true')
    expect(live).toContain("'x-chat-diagnostic-token': chatDiagnosticToken")
  })
})
