import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpile } from 'typescript'
import { describe, expect, it } from 'vitest'
import { SMOKE_PREFIX } from './smoke-test-helpers.js'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const harness = read('./seed-smoke-test.ts')

// Evaluate the actual deterministic definitions and source INSERT mapping only.
// Never import the live entry point, load credentials, or call providers in tests.
function sourceRows(): Array<Record<string, unknown>> {
  const fixtures = harness.match(/const FIXTURES: readonly Fixture\[\] = \[[\s\S]*?\] as const/)
  const mapping = harness.match(/await upsert\('sources', (FIXTURES\.map\([\s\S]*?\)\)), 'platform,post_id'\)/)
  expect(fixtures).not.toBeNull()
  expect(mapping).not.toBeNull()
  return runInNewContext(transpile(`${fixtures![0]}; ${mapping![1]}`), { SMOKE_PREFIX })
}

describe('RAG smoke source fixtures against the current source schema', () => {
  it('supplies every no-default NOT NULL field added by migration 003', () => {
    const migration = read('../supabase/migrations/003_source_collector.sql')
    const required = [...migration.matchAll(/ALTER COLUMN (\w+) SET NOT NULL/g)].map((match) => match[1])
    expect(required).toEqual(['source_type', 'media_urls', 'collected_at', 'collection_method', 'source_metadata'])
    for (const row of sourceRows()) {
      for (const field of required) {
        expect(row[field], field).toBeDefined()
        expect(row[field], field).not.toBeNull()
      }
      expect(row.source_type).toBe('text')
      expect(row.media_urls).toEqual([])
      expect(row.collection_method).toBe('manual')
      expect(row.source_metadata).toEqual({ smoke_test: true, fixture_year: row.festival_year })
    }
  })

  it.each([2025, 2026])('preserves exact %i identities, known dates, and explicit festival semantics', (year) => {
    const rows = sourceRows()
    expect(rows).toHaveLength(2)
    const row = rows.find((value) => value.festival_year === year)!
    expect(row.id).toBe(`00000000-0000-4000-8000-00000000${year}`)
    expect(row.platform).toBe('official')
    expect(row.post_id).toBe(`${SMOKE_PREFIX}rag-temporal-${year}`)
    expect(row.post_url).toBe(`https://smoke-test.invalid/buglasan/rag-temporal-${year}`)
    expect(row.title).toBe(`Buglasan Chess Tournament ${year}`)
    expect(row.post_year).toBe(year)
    expect(row.published_at).toBe(`${year}-10-01T${year === 2025 ? '09' : '10'}:00:00+08:00`)
    expect(row.collected_at).toBe(row.published_at)
    expect(new Date(String(row.published_at)).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', year: 'numeric' })).toBe(String(year))
    expect(row.raw_text).toContain('TEST FIXTURE ONLY.')
    expect(row.normalized_text).toBe(row.raw_text)
    expect(row.status).toBe('active')
    expect(row).not.toHaveProperty('is_current') // Generated from source status by migration 002.
    expect(Object.entries(row).filter(([, value]) => value === null).map(([key]) => key).sort())
      .toEqual(['content_fingerprint', 'supersedes_source_id'])
  })
})
