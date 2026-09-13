import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatService } from './chatService'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('ChatService publishable-key requests', () => {
  it.each([undefined, 'public-override'])('uses only apikey with override %s', async (override) => {
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-from-environment')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          id: 'credential-test-response',
          role: 'assistant',
          content: 'The request was authorized.',
          timestamp: '2026-09-13T00:00:00.000Z',
          sources: [],
          festivalYear: 2026,
        },
        retrievedSources: [],
        retrievedEvents: [],
        yearResolved: 2026,
        language: 'en',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new ChatService({ demoMode: false, edgeFunctionUrl: 'https://example.invalid/functions/v1/chat', supabasePublishableKey: override })
    const request = { message: 'What is the schedule?', festivalYear: 2026 }

    await service.sendMessage(request)

    expect(fetchMock).toHaveBeenCalledWith('https://example.invalid/functions/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: override ?? 'public-from-environment' },
      body: JSON.stringify(request),
      signal: expect.any(AbortSignal),
    })
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
  })
})
