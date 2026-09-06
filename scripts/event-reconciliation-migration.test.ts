import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/011_event_reconciliation.sql', 'utf8').toLowerCase()

describe('Phase 8 reconciliation migration contract', () => {
  it.each(['canonical_events', 'canonical_event_versions', 'event_candidate_associations', 'canonical_event_field_history', 'event_reconciliation_runs', 'event_reconciliation_audit', 'event_reconciliation_reviews'])(`creates and protects %s`, (table) => {
    expect(sql).toContain(`create table public.${table}`)
    expect(sql).toContain(`alter table public.${table} enable row level security`)
  })
  it('uses service-only secured mutation paths with leases and append-only guards', () => {
    for (const contract of ['security definer', "set search_path = pg_catalog, public", "set timezone = 'utc'", 'claim_token', 'lease_expires_at', 'reconciliation history is append-only', 'revoke all on function', 'grant execute on function', 'service_role']) expect(sql).toContain(contract)
  })
  it('preserves exact-year canonical retrieval and exposes current postponed/cancelled corrections', () => {
    expect(sql).toMatch(/ce\.festival_year=target_festival_year[\s\S]*v\.festival_year=target_festival_year/)
    expect(sql).toContain("ce.lifecycle_status in ('scheduled','confirmed','postponed','cancelled')")
    expect(sql).toContain("status_filter is null or v.status=any(status_filter)")
  })
  it('does not alter the immutable Phase 6 candidate ledger', () => {
    expect(sql).not.toMatch(/alter table public\.events\s+(add|alter|drop)/)
    expect(sql).not.toMatch(/update public\.events\s+set/)
  })
})
