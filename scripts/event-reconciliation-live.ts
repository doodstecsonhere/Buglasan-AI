const prefix = 'reconciliation-test-'
const fixtureIds = ['reconciliation-test-01-create', 'reconciliation-test-02-identical', 'reconciliation-test-03-reschedule', 'reconciliation-test-04-cancellation', 'reconciliation-test-05-conflicting-date', 'reconciliation-test-06-distinct', 'reconciliation-test-07-registration-extension', 'reconciliation-test-08-venue-change', 'reconciliation-test-09-postponement', 'reconciliation-test-10-new-schedule', 'reconciliation-test-11-null-year', 'reconciliation-test-12-replay'] as const
const sourceText: Record<(typeof fixtureIds)[number], string> = {
  'reconciliation-test-01-create': 'Buglasan Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.',
  'reconciliation-test-02-identical': 'Buglasan Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.',
  'reconciliation-test-03-reschedule': 'Buglasan Lantern Parade 2027 is rescheduled to October 20, 2027 at 6:00 PM.',
  'reconciliation-test-04-cancellation': 'Buglasan Lantern Parade 2027 is cancelled due to weather.',
  'reconciliation-test-05-conflicting-date': 'Buglasan Lantern Parade 2027 is on October 25, 2027 at 6:00 PM.',
  'reconciliation-test-06-distinct': 'Buglasan Riverside Parade 2027 is confirmed on October 20, 2027 at 6:00 PM at Riverside Park.',
  'reconciliation-test-07-registration-extension': 'Registration for Buglasan Lantern Parade 2027 at Freedom Park on October 18, 2027 at 6:00 PM is extended until October 10, 2027 at 11:59 PM.',
  'reconciliation-test-08-venue-change': 'Buglasan Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Provincial Convention Center.',
  'reconciliation-test-09-postponement': 'Buglasan Lantern Parade 2027 is postponed due to weather. A new date will be announced.',
  'reconciliation-test-10-new-schedule': 'Buglasan Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park after postponement.',
  'reconciliation-test-11-null-year': 'Buglasan Lantern Parade is confirmed on October 18 at 6:00 PM at Freedom Park.',
  'reconciliation-test-12-replay': 'Buglasan Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.',
}
const url = process.env.SUPABASE_URL
const expectedRef = process.env.SUPABASE_EXPECTED_PROJECT_REF
const optIn = process.env.LIVE_EVENT_RECONCILIATION_TEST
const reconcileToken = process.env.RECONCILE_EVENT_TOKEN
const extractionToken = process.env.EXTRACT_SOURCE_TOKEN
const fixtureToken = process.env.RECONCILIATION_ACCEPTANCE_FIXTURE_TOKEN
const extractionFixtureToken = process.env.EXTRACTION_ACCEPTANCE_FIXTURE_TOKEN
const secretKey = (JSON.parse(process.env.SUPABASE_SECRET_KEYS ?? '{}') as Record<string, string>).default ?? process.env.SUPABASE_SECRET_KEY

function guard(): void {
  if (optIn !== 'I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION') throw new Error('Live event reconciliation opt-in is not set')
  if (!url || !expectedRef || !secretKey || !reconcileToken || !extractionToken || !fixtureToken || !extractionFixtureToken) throw new Error('Required server-side environment variable names are not configured')
  if ([reconcileToken, extractionToken, fixtureToken].includes(extractionFixtureToken) || [reconcileToken, extractionToken].includes(fixtureToken)) throw new Error('Acceptance fixture tokens must differ from worker tokens and each other')
  if (new URL(url).hostname.split('.')[0] !== expectedRef) throw new Error('SUPABASE_EXPECTED_PROJECT_REF does not match SUPABASE_URL')
}
async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}${path}`, { ...init, headers: { apikey: secretKey!, 'content-type': 'application/json', ...(init.headers ?? {}) } })
}
async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init); const body = await response.text()
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`)
  return body ? JSON.parse(body) as T : null as T
}
function assert(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(`Acceptance assertion failed: ${label}`) }
async function cleanup(): Promise<void> {
  guard()
  const response = await fetch(`${url}/functions/v1/cleanup-reconciliation-acceptance`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-reconciliation-acceptance-fixture-token': fixtureToken! } })
  const body = await response.text()
  if (!response.ok) throw new Error(`Acceptance cleanup failed: ${response.status}`)
  const result = (body ? JSON.parse(body) : null) as { deleted_sources: number }
  const remaining = await json<Array<{ post_id: string }>>(`/rest/v1/sources?post_id=like.${prefix}*&select=post_id`)
  assert(remaining.length === 0, 'cleanup leaves no reconciliation fixture source')
  console.log(`Reconciliation cleanup removed ${result.deleted_sources} isolated fixture sources.`)
}
async function ingest(id: (typeof fixtureIds)[number], ordinal: number): Promise<string> {
  const text = sourceText[id]
  const publishedDay = String(ordinal).padStart(2, '0')
  const rows = await json<Array<{ source_id: string }>>('/rest/v1/rpc/ingest_source', { method: 'POST', body: JSON.stringify({ p_payload: { platform: 'facebook', post_id: id, post_url: `https://example.invalid/${id}`, published_at: `2027-09-${publishedDay}T08:00:00+08:00`, post_year: 2027, festival_year: 2027, raw_text: text, normalized_text: text, title: id, source_type: 'text', media_urls: [], collected_at: new Date().toISOString(), collection_method: 'manual', source_metadata: { reconciliation_acceptance_fixture: true } } }) })
  assert(rows.length === 1 && typeof rows[0].source_id === 'string', `${id} ingestion returns one source`)
  return rows[0].source_id
}
async function extract(sourceId: string): Promise<{ status: string }> {
  return json('/functions/v1/extract-source', { method: 'POST', headers: { 'x-extraction-token': extractionToken!, 'x-acceptance-fixture-token': extractionFixtureToken! }, body: JSON.stringify({ source_id: sourceId }) })
}
async function candidate(sourceId: string): Promise<Record<string, unknown> | null> {
  // Generated candidates are immutable source evidence. A cancellation is deliberately
  // not retrieval-current, but must remain reconcilable into a canonical correction.
  const rows = await json<Array<Record<string, unknown>>>(`/rest/v1/events?extracted_source_id=eq.${sourceId}&select=*&limit=2`)
  assert(rows.length <= 1, 'fixture source produces at most one generated candidate')
  return rows[0] ?? null
}
async function reconcile(candidateId: string): Promise<{ status: string; cached?: boolean; canonical_event_id?: string | null; error?: string; http_status: number }> {
  const response = await api('/functions/v1/reconcile-event', { method: 'POST', headers: { 'x-reconcile-event-token': reconcileToken! }, body: JSON.stringify({ candidate_event_id: candidateId }) })
  const body = await response.json() as { status: string; cached?: boolean; canonical_event_id?: string | null; error?: string }
  if (response.status === 429 || response.status >= 500 || body.status === 'retryable_error') throw new Error(`provider_unavailable:${response.status}:${body.error ?? body.status}`)
  if (!response.ok && body.status !== 'permanent_error') throw new Error(`reconcile-event failed: ${response.status}:${body.error ?? body.status}`)
  return { ...body, http_status: response.status }
}
async function acceptance(): Promise<void> {
  guard(); await cleanup()
  const source1 = await ingest('reconciliation-test-01-create', 1); const extraction1 = await extract(source1)
  assert(extraction1.status === 'extracted', 'Test 1 deterministic fixture extraction')
  const candidate1 = await candidate(source1); assert(candidate1?.id && candidate1.extraction_identity, 'Test 2 exact generated candidate query')
  const candidateSnapshot = JSON.stringify(candidate1); const first = await reconcile(String(candidate1.id)); assert(first.status === 'reconciled' && first.canonical_event_id, 'Test 3 canonical creation')
  assert(JSON.stringify(await candidate(source1)) === candidateSnapshot, 'Test 4 candidate immutability')
  const canonicalId = String(first.canonical_event_id)
  const scenario = async (id: (typeof fixtureIds)[number], ordinal: number, expectedExtraction: string, expectedReconciliation: string, label: string) => {
    const sourceId = await ingest(id, ordinal); assert((await extract(sourceId)).status === expectedExtraction, `${label} extraction`)
    const event = await candidate(sourceId); assert(event?.id, `${label} candidate`)
    const result = await reconcile(String(event.id)); assert(result.status === expectedReconciliation, `${label} reconciliation outcome`)
    return { sourceId, event, result }
  }
  const repeated = await scenario('reconciliation-test-02-identical', 2, 'extracted', 'reconciled', 'Scenario 2 repeated confirmation')
  assert(repeated.result.canonical_event_id === canonicalId, 'Scenario 2 repeated confirmation has one canonical target')
  const reschedule = await scenario('reconciliation-test-03-reschedule', 3, 'extracted', 'needs_review', 'Scenario 3 explicit reschedule')
  const cancellation = await scenario('reconciliation-test-04-cancellation', 4, 'needs_review', 'needs_review', 'Scenario 4 explicit cancellation')
  const conflict = await scenario('reconciliation-test-05-conflicting-date', 5, 'extracted', 'needs_review', 'Scenario 5 conflicting date without correction')
  const distinct = await scenario('reconciliation-test-06-distinct', 6, 'extracted', 'needs_review', 'Scenario 6 similar but distinct event')
  assert(!distinct.result.canonical_event_id, 'Scenario 6 similar but distinct event remains separate')
  const extension = await scenario('reconciliation-test-07-registration-extension', 7, 'extracted', 'reconciled', 'Scenario 7 registration extension')
  assert(extension.result.canonical_event_id === canonicalId, 'Scenario 7 registration extension targets the initial canonical event')
  const venue = await scenario('reconciliation-test-08-venue-change', 8, 'extracted', 'reconciled', 'Scenario 8 venue change')
  assert(venue.result.canonical_event_id === canonicalId, 'Scenario 8 venue change targets the initial canonical event')
  const postponement = await scenario('reconciliation-test-09-postponement', 9, 'needs_review', 'needs_review', 'Scenario 9 postponement without replacement date')
  const newSchedule = await scenario('reconciliation-test-10-new-schedule', 10, 'extracted', 'reconciled', 'Scenario 10 new schedule after postponement')
  assert(newSchedule.result.canonical_event_id === canonicalId, 'Scenario 10 new schedule targets the initial canonical event')
  const nullYear = await scenario('reconciliation-test-11-null-year', 11, 'needs_review', 'permanent_error', 'Scenario 11 NULL-year probable match')
  assert(nullYear.result.http_status === 422 && !nullYear.result.canonical_event_id, 'Scenario 11 NULL-year probable match does not silently merge')
  const replayCandidate = await scenario('reconciliation-test-12-replay', 12, 'extracted', 'reconciled', 'Scenario 12 exact replay setup')
  assert(replayCandidate.result.canonical_event_id === canonicalId, 'Scenario 12 exact replay uses the initial canonical target')
  const replay = await reconcile(String(replayCandidate.event.id)); assert(replay.cached === true && replay.canonical_event_id === canonicalId, 'Scenario 12 exact replay idempotency')
  const scenarioSources = [source1, repeated.sourceId, reschedule.sourceId, cancellation.sourceId, conflict.sourceId, distinct.sourceId, extension.sourceId, venue.sourceId, postponement.sourceId, newSchedule.sourceId, nullYear.sourceId, replayCandidate.sourceId]
  const [runs, versions, provenance, reviews, sources] = await Promise.all([
    json<Array<Record<string, unknown>>>(`/rest/v1/event_reconciliation_runs?candidate_source_id=in.(${scenarioSources.join(',')})&select=*`),
    json<Array<Record<string, unknown>>>(`/rest/v1/canonical_event_versions?canonical_event_id=eq.${canonicalId}&select=*`),
    json<Array<Record<string, unknown>>>(`/rest/v1/canonical_event_field_history?candidate_event_id=eq.${candidate1.id}&select=*`),
    json<Array<Record<string, unknown>>>(`/rest/v1/event_reconciliation_reviews?candidate_event_id=in.(${[reschedule.event.id, cancellation.event.id, conflict.event.id, distinct.event.id, postponement.event.id].join(',')})&select=*`),
    json<Array<Record<string, unknown>>>(`/rest/v1/sources?id=in.(${scenarioSources.join(',')})&select=id,status`),
  ])
  assert(runs.length === 12 && runs.every((run) => typeof run.status === 'string'), 'all original-scenario reconciliation runs')
  assert(versions.length === 1 && provenance.length >= 2 && reviews.length === 5, 'canonical version, provenance, and original-scenario reviews')
  assert(sources.length === 12 && sources.every((source) => source.status === 'active'), 'reconciliation status never changes source lifecycle')
  console.log('Phase 8 acceptance original scenarios 1–12 passed. Run reconciliation:cleanup after inspection.')
}

/** Minimal live reproduction for Scenario 4: its canonical target must exist first. */
async function scenario4Acceptance(): Promise<void> {
  guard(); await cleanup()
  const source1 = await ingest('reconciliation-test-01-create', 1)
  assert((await extract(source1)).status === 'extracted', 'Scenario 4 setup extraction')
  const initial = await candidate(source1)
  assert(initial?.id, 'Scenario 4 setup candidate')
  const created = await reconcile(String(initial.id))
  assert(created.status === 'reconciled' && created.canonical_event_id, 'Scenario 4 setup canonical creation')

  const cancellationSource = await ingest('reconciliation-test-04-cancellation', 4)
  const extraction = await extract(cancellationSource)
  assert(extraction.status === 'needs_review', 'Scenario 4 explicit cancellation extraction')
  const cancellation = await candidate(cancellationSource)
  assert(cancellation?.id && cancellation.status === 'cancelled' && cancellation.is_current === false, 'Scenario 4 persisted non-current cancellation candidate')
  const result = await reconcile(String(cancellation.id))
  assert(result.status === 'needs_review', 'Scenario 4 explicit cancellation reconciliation outcome')
  console.log('Phase 8 Scenario 4 cancellation acceptance passed. Run reconciliation:cleanup after inspection.')
}

/** Minimal live reproduction for Scenario 7: it requires only the initial canonical target. */
async function scenario7Acceptance(): Promise<void> {
  guard(); await cleanup()
  const source1 = await ingest('reconciliation-test-01-create', 1)
  assert((await extract(source1)).status === 'extracted', 'Scenario 7 setup extraction')
  const initial = await candidate(source1)
  assert(initial?.id, 'Scenario 7 setup candidate')
  const created = await reconcile(String(initial.id))
  assert(created.status === 'reconciled' && created.canonical_event_id, 'Scenario 7 setup canonical creation')

  const extensionSource = await ingest('reconciliation-test-07-registration-extension', 7)
  const extraction = await extract(extensionSource)
  assert(extraction.status === 'extracted', 'Scenario 7 registration-extension extraction')
  const extension = await candidate(extensionSource)
  assert(extension?.id && extension.deadline === '2027-10-10T15:59:00+00:00', 'Scenario 7 explicit deadline candidate')
  const result = await reconcile(String(extension.id))
  assert(result.status === 'reconciled' && result.canonical_event_id === created.canonical_event_id, 'Scenario 7 registration extension targets the initial canonical event')
  console.log('Phase 8 Scenario 7 registration-extension acceptance passed. Run reconciliation:cleanup after inspection.')
}

/** Minimal live reproduction for Scenario 10: preserve the postponement evidence before its replacement schedule. */
async function scenario10Acceptance(): Promise<void> {
  guard(); await cleanup()
  const source1 = await ingest('reconciliation-test-01-create', 1)
  assert((await extract(source1)).status === 'extracted', 'Scenario 10 setup extraction')
  const initial = await candidate(source1)
  assert(initial?.id, 'Scenario 10 setup candidate')
  const created = await reconcile(String(initial.id))
  assert(created.status === 'reconciled' && created.canonical_event_id, 'Scenario 10 setup canonical creation')

  const postponementSource = await ingest('reconciliation-test-09-postponement', 9)
  assert((await extract(postponementSource)).status === 'needs_review', 'Scenario 10 postponement extraction')
  const postponement = await candidate(postponementSource)
  assert(postponement?.id, 'Scenario 10 postponement candidate')
  assert((await reconcile(String(postponement.id))).status === 'needs_review', 'Scenario 10 postponement reconciliation')

  const replacementSource = await ingest('reconciliation-test-10-new-schedule', 10)
  assert((await extract(replacementSource)).status === 'extracted', 'Scenario 10 replacement schedule extraction')
  const replacement = await candidate(replacementSource)
  assert(replacement?.id, 'Scenario 10 replacement schedule candidate')
  const result = await reconcile(String(replacement.id))
  assert(result.status === 'reconciled' && result.canonical_event_id === created.canonical_event_id, 'Scenario 10 replacement schedule targets the initial canonical event')
  console.log('Phase 8 Scenario 10 replacement-schedule acceptance passed. Run reconciliation:cleanup after inspection.')
}

/** Minimal live reproduction for Scenario 12: a completed replay returns its stable canonical target. */
async function scenario12Acceptance(): Promise<void> {
  guard(); await cleanup()
  const source = await ingest('reconciliation-test-12-replay', 12)
  assert((await extract(source)).status === 'extracted', 'Scenario 12 replay setup extraction')
  const replayCandidate = await candidate(source)
  assert(replayCandidate?.id, 'Scenario 12 replay setup candidate')
  const first = await reconcile(String(replayCandidate.id))
  assert(first.status === 'reconciled' && first.canonical_event_id, 'Scenario 12 replay setup canonical creation')
  const replay = await reconcile(String(replayCandidate.id))
  assert(replay.cached === true && replay.canonical_event_id === first.canonical_event_id, 'Scenario 12 exact replay returns the stable canonical target')
  console.log('Phase 8 Scenario 12 exact-replay acceptance passed. Run reconciliation:cleanup after inspection.')
}

async function verifyCleanup(): Promise<void> {
  guard()
  const remaining = await json<Array<{ post_id: string }>>(`/rest/v1/sources?post_id=like.${prefix}*&select=post_id`)
  assert(remaining.length === 0, 'independent cleanup verification leaves zero reconciliation fixture sources')
  console.log('Independent reconciliation fixture count: 0.')
}

const mode = process.argv[2]
if (mode === '--acceptance') await acceptance(); else if (mode === '--scenario-4') await scenario4Acceptance(); else if (mode === '--scenario-7') await scenario7Acceptance(); else if (mode === '--scenario-10') await scenario10Acceptance(); else if (mode === '--scenario-12') await scenario12Acceptance(); else if (mode === '--cleanup') await cleanup(); else if (mode === '--verify-cleanup') await verifyCleanup(); else throw new Error('Use --acceptance, --scenario-4, --scenario-7, --scenario-10, --scenario-12, --cleanup, or --verify-cleanup')

export {}
