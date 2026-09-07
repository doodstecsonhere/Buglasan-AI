import { describe, expect, it, vi } from 'vitest'
import { generateContentWithRetry, isRetryableGenerationFailure } from '../supabase/functions/chat/generationRetry'

const failure = (status: number) => Object.assign(new Error(`provider ${status}`), { status })

describe('generation retry', () => {
  it.each([429, 500, 502, 503, 504])('retries HTTP %s', async (status) => {
    const generate = vi.fn().mockRejectedValueOnce(failure(status)).mockResolvedValue('ok')
    const result = await generateContentWithRetry(generate, { sleep: vi.fn(async () => {}), random: () => 0 })
    expect(result.result).toBe('ok')
    expect(generate).toHaveBeenCalledTimes(2)
  })
  it('uses at most three attempts and records recovery', async () => {
    const generate = vi.fn().mockRejectedValueOnce(failure(503)).mockRejectedValueOnce(failure(503)).mockResolvedValue('ok')
    const result = await generateContentWithRetry(generate, { sleep: vi.fn(async () => {}), random: () => 0 })
    expect(result.metadata).toMatchObject({ generationAttempts: 3, generationRetries: 2, generationRecoveredAfterRetry: true, generationFailureSequence: ['upstream_503', 'upstream_503', 'success'] })
  })
  it('stops after three failures without real sleeps', async () => {
    const generate = vi.fn().mockRejectedValue(failure(503)); const sleep = vi.fn(async () => {})
    await expect(generateContentWithRetry(generate, { sleep, random: () => 0 })).rejects.toBeInstanceOf(Error)
    expect(generate).toHaveBeenCalledTimes(3); expect(sleep).toHaveBeenNthCalledWith(1, 500); expect(sleep).toHaveBeenNthCalledWith(2, 1000)
  })
  it.each([400, 401, 403, 404])('does not retry deterministic HTTP %s', async (status) => {
    const generate = vi.fn().mockRejectedValue(failure(status)); await expect(generateContentWithRetry(generate, { sleep: vi.fn(async () => {}) })).rejects.toBeInstanceOf(Error); expect(generate).toHaveBeenCalledTimes(1)
  })
  it('classifies deterministic transport failures as retryable', () => { expect(isRetryableGenerationFailure(new TypeError('fetch failed'))).toBe(true); expect(isRetryableGenerationFailure(new Error('invalid request'))).toBe(false) })
})
