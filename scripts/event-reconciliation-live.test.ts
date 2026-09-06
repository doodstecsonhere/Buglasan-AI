import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const code = readFileSync(new URL('./event-reconciliation-live.ts', import.meta.url), 'utf8')
const cleanupFunction = readFileSync(new URL('../supabase/functions/cleanup-reconciliation-acceptance/index.ts', import.meta.url), 'utf8')
const reconcileFunction = readFileSync(new URL('../supabase/functions/reconcile-event/index.ts', import.meta.url), 'utf8')

describe('Phase 8.1 live reconciliation acceptance harness contract', () => {
  it('is explicitly gated, uses distinct server secrets, and never emits them', () => {
    for (const name of ['LIVE_EVENT_RECONCILIATION_TEST', 'SUPABASE_EXPECTED_PROJECT_REF', 'RECONCILE_EVENT_TOKEN', 'EXTRACT_SOURCE_TOKEN', 'EXTRACTION_ACCEPTANCE_FIXTURE_TOKEN', 'RECONCILIATION_ACCEPTANCE_FIXTURE_TOKEN']) expect(code).toContain(name)
    expect(code).toContain('Acceptance fixture tokens must differ from worker tokens and each other')
    expect(code).not.toMatch(/console\.(?:log|error)\([^\n]*(?:secretKey|fixtureToken|extractionFixtureToken|reconcileToken|extractionToken)/)
  })
  it('uses real ingestion, deployed extraction, exact source candidate selection, reconciliation, and trusted server cleanup', () => {
    for (const path of ['/rpc/ingest_source', '/functions/v1/extract-source', 'extracted_source_id=eq.${sourceId}&select=*&limit=2', '/functions/v1/reconcile-event', '/functions/v1/cleanup-reconciliation-acceptance']) expect(code).toContain(path)
    expect(code).not.toContain('extracted_source_id=eq.${sourceId}&is_current=eq.true')
    expect(code).toContain('x-acceptance-fixture-token')
    expect(code).toContain('x-reconciliation-acceptance-fixture-token')
  })
  it('formats double-digit fixture publication days as valid RFC 3339 dates before ingesting Scenario 10', () => {
    expect(code).toContain("const publishedDay = String(ordinal).padStart(2, '0')")
    expect(code).toContain('published_at: `2027-09-${publishedDay}T08:00:00+08:00`')
    expect(code).not.toContain('published_at: `2027-09-0${ordinal}T08:00:00+08:00`')
  })
  it('keeps cleanup token verification in a trusted Edge Function and fixes RPC scope server-side', () => {
    expect(cleanupFunction).toContain("Deno.env.get('RECONCILIATION_ACCEPTANCE_FIXTURE_TOKEN')")
    expect(cleanupFunction).toContain('function equal(actual: string, expected: string): boolean')
    expect(cleanupFunction).toContain("'x-reconciliation-acceptance-fixture-token'")
    expect(cleanupFunction).toContain('/rest/v1/rpc/cleanup_reconciliation_acceptance_fixtures')
    expect(cleanupFunction).toContain('authorization: `Bearer ${KEY}`')
    expect(cleanupFunction).toContain('p_fixture_ids: FIXTURE_IDS')
    expect(cleanupFunction).not.toContain('request.json')
    expect(cleanupFunction).not.toMatch(/console\.(?:log|error).*TOKEN/)
  })
  it('maps every original Phase 8 scenario to an independent fixture and semantic outcome', () => {
    for (const scenario of ['Scenario 2 repeated confirmation', 'Scenario 3 explicit reschedule', 'Scenario 4 explicit cancellation', 'Scenario 5 conflicting date without correction', 'Scenario 6 similar but distinct event', 'Scenario 7 registration extension', 'Scenario 8 venue change', 'Scenario 9 postponement without replacement date', 'Scenario 10 new schedule after postponement', 'Scenario 11 NULL-year probable match', 'Scenario 12 exact replay']) expect(code).toContain(scenario)
    for (const fixture of ['01-create', '02-identical', '03-reschedule', '04-cancellation', '05-conflicting-date', '06-distinct', '07-registration-extension', '08-venue-change', '09-postponement', '10-new-schedule', '11-null-year', '12-replay']) expect(code).toContain(`reconciliation-test-${fixture}`)
    expect(code).toContain('Scenario 11 NULL-year probable match does not silently merge')
    expect(code).toContain('Scenario 12 exact replay idempotency')
    expect(code).toContain('response.status === 429 || response.status >= 500')
  })
  it('classifies provider availability without masking intentional permanent acceptance outcomes', () => {
    expect(code).toContain('provider_unavailable:')
    expect(code).toContain("body.status !== 'permanent_error'")
  })

  it('offers a narrow cancellation rerun that proves non-current generated candidates remain reconcilable', () => {
    expect(code).toContain("mode === '--scenario-4'")
    expect(code).toContain('Scenario 4 persisted non-current cancellation candidate')
    expect(code).toContain("cancellation.status === 'cancelled' && cancellation.is_current === false")
    expect(code).toContain('Scenario 4 explicit cancellation reconciliation outcome')
  })

  it('offers a narrow Scenario 10 rerun that preserves postponement evidence before its replacement schedule', () => {
    expect(code).toContain("mode === '--scenario-10'")
    expect(code).toContain("await ingest('reconciliation-test-09-postponement', 9)")
    expect(code).toContain("await ingest('reconciliation-test-10-new-schedule', 10)")
    expect(code).toContain('Scenario 10 replacement schedule targets the initial canonical event')
  })

  it('offers a narrow Scenario 12 replay rerun that returns the stable canonical target', () => {
    expect(code).toContain("mode === '--scenario-12'")
    expect(code).toContain('Scenario 12 replay setup canonical creation')
    expect(code).toContain('Scenario 12 exact replay returns the stable canonical target')
  })

  it('returns the persisted canonical target on a completed replay', () => {
    expect(reconcileFunction).toContain("canonical_event_id: claim.canonical_event_id ?? null, cached: claim.status !== 'processing'")
  })
})
