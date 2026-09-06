import { describe, expect, it } from 'vitest'
import { summarize } from './phase10-status.ts'

describe('Phase 10 status report', () => {
  it('reports non-secret lifecycle counts only', () => {
    const result = summarize([{ source_status: 'active', extraction_status: 'extracted', indexing_status: null }, { source_status: 'updated', extraction_status: 'needs_review', indexing_status: 'indexed' }])
    expect(result).toEqual({ sources: 2, source_status: { active: 1, updated: 1 }, extraction_status: { extracted: 1, needs_review: 1 }, indexing_status: { indexed: 1, unknown: 1 } })
    expect(JSON.stringify(result)).not.toMatch(/secret|token|key/i)
  })
})
