import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/011_event_reconciliation.sql', 'utf8').toLowerCase()
const cleanupSql = readFileSync('supabase/migrations/012_reconciliation_acceptance_cleanup.sql', 'utf8').toLowerCase()

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

describe('Phase 8.1 reconciliation acceptance cleanup contract', () => {
  it('is a service-only, exact-fixture RPC for the trusted cleanup Edge Function', () => {
    expect(cleanupSql).toContain('cleanup_reconciliation_acceptance_fixtures')
    expect(cleanupSql).toContain("auth.role() <> 'service_role'")
    expect(cleanupSql).not.toContain('x-reconciliation-acceptance-fixture-token')
    expect(cleanupSql).not.toContain('app.reconciliation_acceptance_fixture_token')
    expect(cleanupSql).toContain('cardinality(p_fixture_ids) <> 12')
    expect(cleanupSql).toContain('cardinality(ids) <> 12')
    for (const id of ['01-create', '02-identical', '03-reschedule', '04-cancellation', '05-conflicting-date', '06-distinct', '07-registration-extension', '08-venue-change', '09-postponement', '10-new-schedule', '11-null-year', '12-replay']) expect(cleanupSql).toContain(`'reconciliation-test-${id}'`)
    expect(cleanupSql).toContain("ids := array(select distinct unnest(p_fixture_ids) order by 1)")
    expect(cleanupSql).toContain("or ids <> array['reconciliation-test-01-create'")
    expect(cleanupSql).toContain('revoke all on function')
    expect(cleanupSql).toContain('grant execute on function public.cleanup_reconciliation_acceptance_fixtures(text[]) to service_role')
  })
  it('only bypasses append-only triggers inside the tightly-scoped cleanup transaction and refuses shared canonical data', () => {
    expect(cleanupSql).toContain("set_config('app.reconciliation_acceptance_cleanup', 'on', true)")
    expect(cleanupSql).toContain("raise exception 'refusing shared canonical graph'")
    expect(cleanupSql).toContain('candidate_source_id <> all(source_ids)')
    expect(cleanupSql).toContain('post_id <> all(ids)')
    for (const table of ['event_reconciliation_reviews', 'event_reconciliation_audit', 'event_candidate_associations', 'canonical_event_field_history', 'canonical_event_versions', 'canonical_events', 'event_reconciliation_runs', 'events', 'sources']) expect(cleanupSql).toContain(`delete from public.${table}`)
  })
})
