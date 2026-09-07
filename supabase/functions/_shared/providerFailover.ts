import { isFailoverEligible } from './providerErrors.ts'
import type { ProviderAdapter } from './providerAdapters.ts'
import type { ProviderRequest, ProviderResult } from './providerTypes.ts'

export async function generateWithFailover<T>(request: ProviderRequest, primary: ProviderAdapter, secondary: ProviderAdapter | undefined, parse: (text: string, provider: ProviderAdapter) => T, options: { sleep?: (ms: number) => Promise<void>; maxPrimary?: number; maxSecondary?: number } = {}): Promise<ProviderResult<T>> {
  const sleep = options.sleep ?? (async () => {})
  const maxPrimary = options.maxPrimary ?? 3
  const maxSecondary = options.maxSecondary ?? 2
  let lastError: unknown
  const failures: string[] = []
  for (let attempt = 1; attempt <= maxPrimary; attempt++) {
    try { const response = await primary.generate(request); return { value: parse(response.text, primary), metadata: { provider: primary.provider, model: primary.model, attempts: attempt, retries: attempt - 1, failures } } }
    catch (error) { lastError = error; failures.push(error instanceof Error && error.name === 'ProviderError' ? (error as unknown as { category: string }).category : 'application_error'); if (!isFailoverEligible(error) || attempt === maxPrimary) break; await sleep(250 * 2 ** (attempt - 1)) }
  }
  if (secondary && isFailoverEligible(lastError)) {
    for (let attempt = 1; attempt <= maxSecondary; attempt++) {
      try { const response = await secondary.generate(request, options.signal); return { value: parse(response.text, secondary), metadata: { provider: secondary.provider, model: secondary.model, attempts: maxPrimary + attempt, retries: maxPrimary + attempt - 1, failures } } }
      catch (error) { lastError = error; failures.push(error instanceof Error && error.name === 'ProviderError' ? (error as unknown as { category: string }).category : 'application_error'); if (!isFailoverEligible(error) || attempt === maxSecondary) break; await sleep(250 * 2 ** (attempt - 1)) }
    }
  }
  throw lastError
}
