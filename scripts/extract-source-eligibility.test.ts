import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const code = readFileSync(new URL('../supabase/functions/extract-source/index.ts', import.meta.url), 'utf8')

describe('extract-source Phase 10 lifecycle eligibility', () => {
  it('accepts active, updated, and postponed while rejecting terminal source states', () => {
    expect(code).toContain("['active', 'updated', 'postponed'].includes(String(source.status))")
    expect(code).not.toContain("source.status !== 'active'")
    expect(code).toContain('source_ineligible')
  })
})
