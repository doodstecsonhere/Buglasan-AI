import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/013_orchestration_status.sql', 'utf8').toLowerCase()
const cleanupSql = readFileSync('supabase/migrations/014_pipeline_acceptance_cleanup.sql', 'utf8').toLowerCase()

describe('Phase 9 orchestration migration contract', () => {
  it('only adds a service-only dispatch planner and status view', () => {
    expect(sql).toContain('create or replace function public.get_orchestration_dispatch')
    expect(sql).toContain('create or replace view public.orchestration_status')
    expect(sql).toContain('security definer')
    expect(sql).toContain('revoke all on function')
    expect(sql).toContain('grant execute on function public.get_orchestration_dispatch(uuid,boolean) to service_role')
    expect(sql).not.toMatch(/alter table public\.(sources|events|source_chunks)/)
  })
  it('uses exact processor configurations and only reclaims expired leases', () => {
    expect(sql).toContain("extractor_version='phase6-v1'")
    expect(sql).toContain("indexer_version='semantic-index-v1' and embedding_model='gemini-embedding-001'")
    expect(sql).toContain("reconciler_version='reconciler-v1'")
    expect(sql).toContain("extraction_status='processing' and extraction_lease_expires_at<=clock_timestamp()")
    expect(sql).toContain("indexing_status='processing' and indexing_lease_expires_at<=clock_timestamp()")
    expect(sql).toContain("r.status='processing' and r.lease_expires_at<=clock_timestamp()")
  })
  it('bounds deterministic candidate results and reports continuation', () => {
    expect(sql).toContain('candidate_limit constant integer := 25')
    expect(sql).toContain('order by candidate_index, id limit candidate_limit')
    expect(sql).toContain("'remaining_candidate_count'")
    expect(sql).toContain("'has_more_candidates'")
    expect(sql).toContain('e.is_current')
    expect(sql).toContain('coalesce(array_length(e.review_reasons,1),0)=0')
  })
  it('adds a separate fixed Phase 9 fixture cleanup contract', () => {
    expect(cleanupSql).toContain('cleanup_pipeline_acceptance_fixtures')
    expect(cleanupSql).toContain('pipeline-test-01-current')
    expect(cleanupSql).toContain('refusing shared canonical graph')
  })
})
