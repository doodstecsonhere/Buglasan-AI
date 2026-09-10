import { ProviderError, classifyHttpStatus, classifyTransport } from './providerErrors.ts'
import type { ProviderRequest, ProviderResponse, ProviderName } from './providerTypes.ts'

declare const Deno: { env: { get(name: string): string | undefined } }

export interface ProviderAdapter { readonly provider: ProviderName; readonly model: string; generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> }

export function geminiAdapter(model: string, generate: (prompt: string, signal?: AbortSignal) => Promise<string>): ProviderAdapter {
  return { provider: 'gemini', model, async generate(request, signal) {
    try {
      const text = await generate(request.prompt, signal)
      if (typeof text !== 'string' || !text) throw new ProviderError('gemini', 'malformed_output', 'provider response was empty')
      return { text, provider: 'gemini', model }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError('gemini', classifyTransport(error), 'Gemini transport failure')
    }
  } }
}

export function geminiRestAdapter(apiKey: string, model: string, fetcher: typeof fetch = fetch): ProviderAdapter {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  return { provider: 'gemini', model, async generate(request, signal) {
    let response: Response
    try {
      response = await fetcher(endpoint, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: request.prompt }] }], generationConfig: { ...(request.structured ? { responseMimeType: 'application/json' } : {}), temperature: 0 } }) })
    } catch (error) { throw new ProviderError('gemini', classifyTransport(error), 'Gemini transport failure') }
    if (!response.ok) throw new ProviderError('gemini', classifyHttpStatus(response.status), `Gemini HTTP ${response.status}`, response.status)
    let payload: unknown
    try { payload = await response.json() } catch { throw new ProviderError('gemini', 'malformed_output', 'Gemini response was not JSON') }
    const text = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof text !== 'string' || !text) throw new ProviderError('gemini', 'malformed_output', 'Gemini response envelope was invalid')
    return { text, provider: 'gemini', model }
  } }
}

export function openAICompatibleAdapter(baseUrl: string, apiKey: string, model: string, fetcher: typeof fetch = fetch): ProviderAdapter {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  return { provider: 'openai_compatible', model, async generate(request, signal) {
    let response: Response
    try {
      response = await fetcher(endpoint, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: request.prompt }], temperature: 0, ...(request.structured ? { response_format: { type: 'json_object' } } : {}) }) })
    } catch (error) { throw new ProviderError('openai_compatible', classifyTransport(error), 'secondary transport failure') }
    if (!response.ok) throw new ProviderError('openai_compatible', classifyHttpStatus(response.status), `secondary provider HTTP ${response.status}`, response.status)
    let payload: unknown
    try { payload = await response.json() } catch { throw new ProviderError('openai_compatible', 'malformed_output', 'secondary response was not JSON') }
    const text = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text) throw new ProviderError('openai_compatible', 'malformed_output', 'secondary response envelope was invalid')
    return { text, provider: 'openai_compatible', model }
  } }
}

export function configuredSecondaryAdapter(fetcher?: typeof fetch): ProviderAdapter | undefined {
  const base = Deno.env.get('OPENAI_COMPATIBLE_BASE_URL') ?? ''
  const key = Deno.env.get('OPENAI_COMPATIBLE_API_KEY') ?? ''
  const model = Deno.env.get('OPENAI_COMPATIBLE_MODEL') ?? ''
  return base && key && model ? openAICompatibleAdapter(base, key, model, fetcher) : undefined
}
