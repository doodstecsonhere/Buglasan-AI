import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const code = readFileSync(new URL('./event-reconciliation-live.ts', import.meta.url), 'utf8')

describe('Phase 8.1 live reconciliation acceptance harness contract', () => {
  it('is explicitly gated, uses distinct server secrets, and never emits them', () => {
    for (const name of ['LIVE_EVENT_RECONCILIATION_TEST', 'SUPABASE_EXPECTED_PROJECT_REF', 'RECONCILE_EVENT_TOKEN', 'EXTRACT_SOURCE_TOKEN', 'EXTRACTION_ACCEPTANCE_FIXTURE_TOKEN', 'RECONCILIATION_ACCEPTANCE_FIXTURE_TOKEN']) expect(code).toContain(name)
    expect(code).toContain('Acceptance fixture tokens must differ from worker tokens and each other')
    expect(code).not.toMatch(/console\.(?:log|error)\([^\n]*(?:secretKey|fixtureToken|extractionFixtureToken|reconcileToken|extractionToken)/)
  })
  it('uses real ingestion, deployed extraction, exact candidate selection, reconciliation, and server cleanup', () => {
    for (const path of ['/rpc/ingest_source', '/functions/v1/extract-source', 'extracted_source_id=eq.${sourceId}', '/functions/v1/reconcile-event', '/rpc/cleanup_reconciliation_acceptance_fixtures']) expect(code).toContain(path)
    expect(code).toContain('x-acceptance-fixture-token')
    expect(code).toContain('x-reconciliation-acceptance-fixture-token')
  })
  it('asserts all Phase 8.1 acceptance distinctions and classifies provider availability', () => {
    for (const assertion of ['Test 1', 'Test 2', 'Test 3', 'Test 4', 'Test 5', 'Test 6', 'Test 7', 'Test 8', 'Test 9', 'Test 10', 'Test 11', 'Test 12', 'candidate immutability', 'similar is not same', 'unknown is review, not no event', 'no event is distinct from unknown', 'reconciliation idempotency', 'status never changes source lifecycle']) expect(code).toContain(assertion)
    expect(code).toContain('provider_unavailable:')
    expect(code).toContain('response.status === 429 || response.status >= 500')
  })
})
