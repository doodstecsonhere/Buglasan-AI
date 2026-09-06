import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
const path = 'supabase/migrations/009_semantic_indexing.sql'
const sql = readFileSync(path, 'utf8').toLowerCase()
const hotfix = readFileSync('supabase/migrations/010_fix_semantic_indexing_uuid_schema.sql', 'utf8').toLowerCase()
describe('semantic indexing migration contract', () => {
  it('keeps the scoped Phase 7 UUID schema hotfix in the migration sequence', () => expect(readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))).toContain('010_fix_semantic_indexing_uuid_schema.sql'))
  it('resolves uuid-ossp functions from the hosted extensions schema', () => {
    expect(sql).toContain('extensions.uuid_generate_v5(extensions.uuid_ns_url()')
    expect(sql).not.toContain('public.uuid_generate_v5(public.uuid_ns_url()')
    expect(hotfix).toContain("'public.uuid_generate_v5(public.uuid_ns_url()'")
    expect(hotfix).toContain("'extensions.uuid_generate_v5(extensions.uuid_ns_url()'")
  })
  it.each(['source_indexings','security definer','set search_path','for update','claim_token','lease_expires_at','source_fingerprint','embedding_dimensions=768','is_current','superseded_at','uuid_generate_v5','non-deterministic indexing replay','security_invoker=true','revoke all','service_role'])(`contains %s`, (contract) => expect(sql).toContain(contract))
  it('makes retrieval current-only and year-authoritative', () => expect(sql).toMatch(/sc\.is_current[\s\S]*s\.is_current[\s\S]*s\.festival_year=target_festival_year/))
  it('rejects conflicting exact-identity replays before replacing current chunks', () => {
    expect(sql).toMatch(/if exists\([\s\S]*staged_index_chunks staged[\s\S]*existing\.embedding<>staged\.embedding[\s\S]*non-deterministic indexing replay[\s\S]*insert into public\.source_chunks/)
  })
})
