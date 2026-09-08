import { ExtractionDiagnosticError, parseModelJson, validateExtractionResult } from './extraction.ts'
import { ProviderError } from './providerErrors.ts'
import { generateWithFailover } from './providerFailover.ts'
import type { ProviderAdapter } from './providerAdapters.ts'
import type { ProviderFailoverOptions } from './providerFailover.ts'

export async function extractWithFailover(sourceText: string, prompt: string, primary: ProviderAdapter, secondary?: ProviderAdapter, options?: ProviderFailoverOptions) {
  return generateWithFailover({ prompt, structured: true }, primary, secondary, (text, provider) => {
    try { return validateExtractionResult(parseModelJson(text), sourceText).result }
    catch (error) {
      const diagnostic = error instanceof ExtractionDiagnosticError ? error.diagnostic : 'unknown_failure' as const
      throw new ProviderError(provider.provider, 'validation_failed', 'structured extraction validation failed', undefined, diagnostic)
    }
  }, options)
}
