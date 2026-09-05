import { describe, expect, it } from 'vitest'
import { LIVE_OPT_IN, assertAcceptanceAnswer, assertLiveSafety, assertOnlyYear, extractCitations, normalizeEmbedding } from './smoke-test-helpers.js'

describe('smoke harness safety helpers', () => {
  it('requires exact live opt-in and matching project ref', () => {
    expect(() => assertLiveSafety({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_EXPECTED_PROJECT_REF: 'abc' })).toThrow()
    expect(assertLiveSafety({ LIVE_RAG_SMOKE_TEST: LIVE_OPT_IN, SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_EXPECTED_PROJECT_REF: 'abc' })).toEqual({ projectRef: 'abc' })
    expect(() => assertLiveSafety({ LIVE_RAG_SMOKE_TEST: LIVE_OPT_IN, SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_EXPECTED_PROJECT_REF: 'other' })).toThrow(/does not match/)
  })

  it('requires exactly 768 finite values and normalizes them', () => {
    expect(() => normalizeEmbedding([1])).toThrow(/exactly 768/)
    const values = Array(768).fill(2) as number[]
    values[10] = Number.NaN
    expect(() => normalizeEmbedding(values)).toThrow(/finite/)
    const normalized = normalizeEmbedding(Array(768).fill(2))
    expect(Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 12)
  })

  it('rejects cross-year rows and reads nested citations', () => {
    expect(() => assertOnlyYear([{ festival_year: 2025 }, { source_festival_year: 2026 }], 2025, 'sources')).toThrow(/cross-year/)
    expect(extractCitations({ message: { sources: [{ id: 'one' }] } })).toEqual([{ id: 'one' }])
  })

  it('enforces fixture answers and no historical fallback', () => {
    expect(() => assertAcceptanceAnswer('October 21, 2026 at 10:00 AM at the Negros Oriental Convention Center.', 2026, 'fixture')).not.toThrow()
    expect(() => assertAcceptanceAnswer('October 16, 2025 at 9 AM at the Negros Oriental Convention Center.', 2025, 'fixture')).not.toThrow()
    expect(() => assertAcceptanceAnswer('No current official information found for 2026.', 2026, 'unavailable')).not.toThrow()
    expect(() => assertAcceptanceAnswer('No current official information was found for Buglasan Festival 2026. Please check the official Buglasan Festival Facebook Page for verified updates: https://www.facebook.com/Buglasan', 2026, 'unavailable')).not.toThrow()
    expect(() => assertAcceptanceAnswer('Use the October 16, 2025 schedule.', 2026, 'unavailable')).toThrow(/2026|refuse|fall back/)
  })
})
