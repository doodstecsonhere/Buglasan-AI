import { describe, expect, it } from 'vitest'
import { generateWithFailover } from './providerFailover.ts'
import { ProviderError, classifyHttpStatus, classifyTransport, safeProviderError } from './providerErrors.ts'
import { extractWithFailover } from './providerExtraction.ts'
import type { ProviderAdapter } from './providerAdapters.ts'

const adapter = (provider: 'gemini' | 'openai_compatible', errors: unknown[] = []): ProviderAdapter => ({ provider, model: 'test', async generate() { const error = errors.shift(); if (error) throw error; return { text: 'ok', provider, model: 'test' } } })
describe('provider failover foundation', () => {
  it('does not fallback after primary success', async () => { const secondary = adapter('openai_compatible'); const result = await generateWithFailover({ prompt: 'x' }, adapter('gemini'), secondary, (text) => text); expect(result.value).toBe('ok') })
  it('passes the abort signal to each provider attempt', async () => {
    const signal = new AbortController().signal
    const received: AbortSignal[] = []
    const primary = { ...adapter('gemini'), generate: async (_request: { prompt: string }, attemptSignal?: AbortSignal) => { received.push(attemptSignal as AbortSignal); throw new ProviderError('gemini', 'upstream_503', 'safe') } }
    const secondary = { ...adapter('openai_compatible'), generate: async (_request: { prompt: string }, attemptSignal?: AbortSignal) => { received.push(attemptSignal as AbortSignal); return { text: 'ok', provider: 'openai_compatible' as const, model: 'test' } } }
    await generateWithFailover({ prompt: 'x' }, primary, secondary, (text) => text, { signal, maxPrimary: 1 })
    expect(received).toEqual([signal, signal])
  })
  it('stops during primary retry backoff without another attempt or fallback', async () => {
    const controller = new AbortController()
    let primaryCalls = 0
    let secondaryCalls = 0
    let releaseSleep!: () => void
    const sleep = () => new Promise<void>((resolve) => { releaseSleep = resolve })
    const primary = { ...adapter('gemini'), generate: async () => { primaryCalls++; throw new ProviderError('gemini', 'upstream_503', 'safe') } }
    const secondary = { ...adapter('openai_compatible'), generate: async () => { secondaryCalls++; return { text: 'unexpected', provider: 'openai_compatible' as const, model: 'test' } } }
    const pending = generateWithFailover({ prompt: 'x' }, primary, secondary, (text) => text, { signal: controller.signal, sleep, maxPrimary: 3 })
    await Promise.resolve()
    controller.abort('raw cancellation detail')
    releaseSleep()
    await expect(pending).rejects.toMatchObject({ message: 'provider operation aborted' })
    expect(primaryCalls).toBe(1)
    expect(secondaryCalls).toBe(0)
  })
  it('does not fallback when the signal aborts during a provider attempt', async () => {
    const controller = new AbortController()
    let secondaryCalls = 0
    const primary = { ...adapter('gemini'), generate: async () => { controller.abort('raw cancellation detail'); throw new ProviderError('gemini', 'timeout', 'safe') } }
    const secondary = { ...adapter('openai_compatible'), generate: async () => { secondaryCalls++; return { text: 'unexpected', provider: 'openai_compatible' as const, model: 'test' } } }
    await expect(generateWithFailover({ prompt: 'x' }, primary, secondary, (text) => text, { signal: controller.signal, maxPrimary: 1 })).rejects.toMatchObject({ message: 'provider operation aborted' })
    expect(secondaryCalls).toBe(0)
  })
  it('falls back only after transient exhaustion and bounds attempts', async () => { let secondaryCalls = 0; const secondary = adapter('openai_compatible'); const wrapped = { ...secondary, generate: async () => { secondaryCalls++; if (secondaryCalls === 1) throw new ProviderError('openai_compatible', 'upstream_503', 'x'); return { text: 'ok', provider: 'openai_compatible' as const, model: 'test' } } }; const result = await generateWithFailover({ prompt: 'x' }, adapter('gemini', [new ProviderError('gemini', 'upstream_503', 'x'), new ProviderError('gemini', 'upstream_503', 'x'), new ProviderError('gemini', 'upstream_503', 'x')]), wrapped, (text) => text); expect(result.value).toBe('ok'); expect(secondaryCalls).toBe(2) })
  it('does not fallback for deterministic failures', async () => { await expect(generateWithFailover({ prompt: 'x' }, adapter('gemini', [new ProviderError('gemini', 'invalid_request', 'x')]), adapter('openai_compatible'), (text) => text)).rejects.toThrow('x') })

  it.each([429, 500, 502, 503, 504])('fails over for transient HTTP %s', async (status) => {
    const secondary = adapter('openai_compatible')
    const result = await generateWithFailover({ prompt: 'x' }, adapter('gemini', [new ProviderError('gemini', classifyHttpStatus(status), 'safe')]), secondary, (text) => text, { maxPrimary: 1 })
    expect(result.value).toBe('ok')
  })

  it.each(['timeout', 'dns failure', 'connection reset', 'connection refused', 'fetch failed'])('fails over for network failure %s', async (message) => {
    const result = await generateWithFailover({ prompt: 'x' }, adapter('gemini', [new ProviderError('gemini', classifyTransport(new Error(message)), 'safe')]), adapter('openai_compatible'), (text) => text, { maxPrimary: 1 })
    expect(result.value).toBe('ok')
  })

  it('does not expose provider messages or credentials in safe errors', () => {
    const safe = safeProviderError(new ProviderError('gemini', 'authentication_rejected', 'secret-api-key raw body', 401))
    expect(safe).toEqual({ provider: 'gemini', category: 'authentication_rejected', httpStatus: 401 })
    expect(JSON.stringify(safe)).not.toContain('secret-api-key')
  })

  it('rejects malformed fallback output with the fallback provider identity', async () => {
    const primary = adapter('gemini', [
      new ProviderError('gemini', 'upstream_503', 'safe'),
      new ProviderError('gemini', 'upstream_503', 'safe'),
      new ProviderError('gemini', 'upstream_503', 'safe'),
    ])
    const secondary: ProviderAdapter = {
      provider: 'openai_compatible',
      model: 'test',
      async generate() { return { text: 'not-json', provider: 'openai_compatible', model: 'test' } },
    }
    await expect(extractWithFailover('Official event at 10:00 AM', 'unchanged prompt', primary, secondary, { sleep: async () => {} })).rejects.toMatchObject({ provider: 'openai_compatible', category: 'validation_failed', diagnostic: 'malformed_json' })
  })
})
