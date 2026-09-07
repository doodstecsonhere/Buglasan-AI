import { parseModelJson, validateExtractionResult } from './extraction.ts'
import { ProviderError } from './providerErrors.ts'
import { generateWithFailover } from './providerFailover.ts'
import type { ProviderAdapter } from './providerAdapters.ts'

export async function extractWithFailover(sourceText: string, prompt: string, primary: ProviderAdapter, secondary?: ProviderAdapter, options?: { sleep?: (ms: number) => Promise<void>; signal?: AbortSignal }) {
  return generateWithFailover({ prompt, structured: true }, primary, secondary, (text, provider) => {
    try { return validateExtractionResult(parseModelJson(text), sourceText).result }
    catch { throw new ProviderError(provider.provider, 'validation_failed', 'structured extraction validation failed') }
  }, options)
}
