import { isFailoverEligible } from './providerErrors.ts'
import type { ProviderAdapter } from './providerAdapters.ts'
import type { ProviderRequest, ProviderResult } from './providerTypes.ts'

export interface ProviderFailoverOptions {
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
  maxPrimary?: number
  maxSecondary?: number
}

function failureCategory(error: unknown): string {
  return error instanceof Error && error.name === 'ProviderError' && 'category' in error
    ? String((error as Error & { category: unknown }).category)
    : 'application_error'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('provider operation aborted')
}

async function waitForRetry(ms: number, sleep: (ms: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  if (!signal) return sleep(ms)
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(new Error('provider operation aborted')) }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    sleep(ms).then(() => { cleanup(); resolve() }, (error) => { cleanup(); reject(error) })
    if (signal.aborted) onAbort()
  })
}

export async function generateWithFailover<T>(request: ProviderRequest, primary: ProviderAdapter, secondary: ProviderAdapter | undefined, parse: (text: string, provider: ProviderAdapter) => T, options: ProviderFailoverOptions = {}): Promise<ProviderResult<T>> {
  const sleep = options.sleep ?? (async () => {})
  const maxPrimary = options.maxPrimary ?? 3
  const maxSecondary = options.maxSecondary ?? 2
  let lastError: unknown
  const failures: string[] = []
  for (let attempt = 1; attempt <= maxPrimary; attempt++) {
    throwIfAborted(options.signal)
    try { const response = await primary.generate(request, options.signal); return { value: parse(response.text, primary), metadata: { provider: primary.provider, model: primary.model, attempts: attempt, retries: attempt - 1, failures } }
    } catch (error) { throwIfAborted(options.signal); lastError = error; failures.push(failureCategory(error)); if (!isFailoverEligible(error) || attempt === maxPrimary) break; await waitForRetry(250 * 2 ** (attempt - 1), sleep, options.signal) }
  }
  throwIfAborted(options.signal)
  if (secondary && isFailoverEligible(lastError)) {
    for (let attempt = 1; attempt <= maxSecondary; attempt++) {
      throwIfAborted(options.signal)
      try { const response = await secondary.generate(request, options.signal); return { value: parse(response.text, secondary), metadata: { provider: secondary.provider, model: secondary.model, attempts: maxPrimary + attempt, retries: maxPrimary + attempt - 1, failures } }
      }
      catch (error) { throwIfAborted(options.signal); lastError = error; failures.push(failureCategory(error)); if (!isFailoverEligible(error) || attempt === maxSecondary) break; await waitForRetry(250 * 2 ** (attempt - 1), sleep, options.signal) }
    }
  }
  throw lastError
}
