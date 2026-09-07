import { getGenerationFailure, type GenerationFailure } from './generationDiagnostics.ts'

export interface GenerationRetryMetadata {
  generationAttempts: number
  generationRetries: number
  generationRecoveredAfterRetry: boolean
  generationFailureSequence: string[]
}

export interface GenerationRetryOptions {
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
  baseDelayMs?: number
}

export const GENERATION_RETRY_METADATA = Symbol('generationRetryMetadata')

const MAX_ATTEMPTS = 3

export function isRetryableGenerationFailure(error: unknown): boolean {
  const failure = getGenerationFailure(error)
  if ([429, 500, 502, 503, 504].includes(failure.httpStatus ?? -1)) return true
  return ['timeout', 'dns_failure', 'connection_reset', 'connection_failure', 'fetch_failed'].includes(failure.messageCategory)
}

export async function generateContentWithRetry<T>(
  generate: () => Promise<T>,
  options: GenerationRetryOptions = {},
): Promise<{ result: T; metadata: GenerationRetryMetadata }> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const random = options.random ?? Math.random
  const baseDelayMs = options.baseDelayMs ?? 500
  const metadata: GenerationRetryMetadata = { generationAttempts: 0, generationRetries: 0, generationRecoveredAfterRetry: false, generationFailureSequence: [] }
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    metadata.generationAttempts = attempt
    try {
      const result = await generate()
      metadata.generationRecoveredAfterRetry = attempt > 1
      metadata.generationFailureSequence.push('success')
      return { result, metadata }
    } catch (error) {
      lastError = error
      const failure: GenerationFailure = getGenerationFailure(error)
      metadata.generationFailureSequence.push(failure.messageCategory)
      if (!isRetryableGenerationFailure(error) || attempt === MAX_ATTEMPTS) {
        if (error && typeof error === 'object') Object.defineProperty(error, GENERATION_RETRY_METADATA, { value: { ...metadata }, configurable: true })
        throw error
      }
      metadata.generationRetries++
      const delay = baseDelayMs * 2 ** (attempt - 1)
      await sleep(delay + Math.floor(random() * Math.min(delay, 500)))
    }
  }
  throw lastError
}
