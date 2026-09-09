import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/017_repair_cached_index_currentness.sql', 'utf8')

describe('Phase 10 semantic currentness repair', () => {
  it('reclaims indexed work only when its exact indexed chunks are no longer current', () => {
    expect(migration).toContain("IF v.status='indexed' THEN")
    expect(migration).toContain('source_fingerprint=p_source_fingerprint')
    expect(migration).toContain('embedding_model=p_embedding_model')
    expect(migration).toContain('AND is_current')
    expect(migration).toContain('current_chunk_count=v.chunk_count AND current_chunk_count>0')
  })
  it('preserves terminal no-text, review, permanent-error, and leased processing cache behavior', () => {
    expect(migration).toContain("v.status IN ('no_text','needs_review','permanent_error')")
    expect(migration).toContain("v.status='processing' AND v.lease_expires_at>clock_timestamp()")
  })
})
