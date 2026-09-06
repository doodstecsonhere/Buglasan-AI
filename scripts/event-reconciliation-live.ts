const prefix = 'reconciliation-test-'
const fixtureIds = ['reconciliation-test-01-create', 'reconciliation-test-02-identical', 'reconciliation-test-03-similar', 'reconciliation-test-04-unknown', 'reconciliation-test-05-no-event', 'reconciliation-test-06-newest'] as const
const sourceText: Record<(typeof fixtureIds)[number], string> = {
  'reconciliation-test-01-create': 'Buglasan Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.',
  'reconciliation-test-02-identical': 'Buglasan Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.',
  'reconciliation-test-03-similar': 'Buglasan Lantern Festival Parade 2027 is confirmed on October 20, 2027 at 6:00 PM at Riverside Park.',
  'reconciliation-test-04-unknown': 'Buglasan Lantern Parade 2027 is planned at Freedom Park.',
  'reconciliation-test-05-no-event': 'Thank you for supporting Buglasan 2027.',
  'reconciliation-test-06-newest': 'Buglasan Lantern Parade 2027 is confirmed on October 18, 2027 at 7:00 PM at Freedom Park.',
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
  const result = await json<{ deleted_sources: number }>('/rest/v1/rpc/cleanup_reconciliation_acceptance_fixtures', { method: 'POST', headers: { 'x-reconciliation-acceptance-fixture-token': fixtureToken! }, body: JSON.stringify({ p_fixture_ids: fixtureIds }) })
  const remaining = await json<Array<{ post_id: string }>>(`/rest/v1/sources?post_id=like.${prefix}*&select=post_id`)
  assert(remaining.length === 0, 'cleanup leaves no reconciliation fixture source')
  console.log(`Reconciliation cleanup removed ${result.deleted_sources} isolated fixture sources.`)
}
async function ingest(id: (typeof fixtureIds)[number], ordinal: number): Promise<string> {
  const text = sourceText[id]
  const rows = await json<Array<{ source_id: string }>>('/rest/v1/rpc/ingest_source', { method: 'POST', body: JSON.stringify({ p_payload: { platform: 'facebook', post_id: id, post_url: `https://example.invalid/${id}`, published_at: `2027-09-0${ordinal}T08:00:00+08:00`, post_year: 2027, festival_year: 2027, raw_text: text, normalized_text: text, title: id, source_type: 'text', media_urls: [], collected_at: new Date().toISOString(), collection_method: 'manual', source_metadata: { reconciliation_acceptance_fixture: true } } }) })
  assert(rows.length === 1 && typeof rows[0].source_id === 'string', `${id} ingestion returns one source`)
  return rows[0].source_id
}
async function extract(sourceId: string): Promise<{ status: string }> {
  return json('/functions/v1/extract-source', { method: 'POST', headers: { 'x-extraction-token': extractionToken!, 'x-acceptance-fixture-token': extractionFixtureToken! }, body: JSON.stringify({ source_id: sourceId }) })
}
async function candidate(sourceId: string): Promise<Record<string, unknown> | null> {
  const rows = await json<Array<Record<string, unknown>>>(`/rest/v1/events?extracted_source_id=eq.${sourceId}&is_current=eq.true&select=*&limit=2`)
  assert(rows.length <= 1, 'fixture source produces at most one generated candidate')
  return rows[0] ?? null
}
async function reconcile(candidateId: string): Promise<{ status: string; cached?: boolean; canonical_event_id?: string | null; error?: string }> {
  const response = await api('/functions/v1/reconcile-event', { method: 'POST', headers: { 'x-reconcile-event-token': reconcileToken! }, body: JSON.stringify({ candidate_event_id: candidateId }) })
  const body = await response.json() as { status: string; cached?: boolean; canonical_event_id?: string | null; error?: string }
  if (response.status === 429 || response.status >= 500 || body.status === 'retryable_error') throw new Error(`provider_unavailable:${response.status}:${body.error ?? body.status}`)
  if (!response.ok) throw new Error(`reconcile-event failed: ${response.status}:${body.error ?? body.status}`)
  return body
}
async function acceptance(): Promise<void> {
  guard(); await cleanup()
  const source1 = await ingest('reconciliation-test-01-create', 1); const extraction1 = await extract(source1)
  assert(extraction1.status === 'extracted', 'Test 1 deterministic fixture extraction')
  const candidate1 = await candidate(source1); assert(candidate1?.id && candidate1.extraction_identity, 'Test 2 exact generated candidate query')
  const candidateSnapshot = JSON.stringify(candidate1); const first = await reconcile(String(candidate1.id)); assert(first.status === 'reconciled' && first.canonical_event_id, 'Test 3 canonical creation')
  assert(JSON.stringify(await candidate(source1)) === candidateSnapshot, 'Test 4 candidate immutability')
  const canonicalId = String(first.canonical_event_id)
  const source2 = await ingest('reconciliation-test-02-identical', 2); assert((await extract(source2)).status === 'extracted', 'Test 5 identical extraction')
  const candidate2 = await candidate(source2); assert(candidate2?.id, 'Test 5 identical candidate')
  const identical = await reconcile(String(candidate2.id)); assert(identical.status === 'reconciled' && identical.canonical_event_id === canonicalId, 'Test 5 same identity has one canonical target')
  const replay = await reconcile(String(candidate2.id)); assert(replay.cached === true && replay.canonical_event_id === canonicalId, 'Test 6 reconciliation idempotency')
  const source3 = await ingest('reconciliation-test-03-similar', 3); assert((await extract(source3)).status === 'extracted', 'Test 7 similar extraction')
  const candidate3 = await candidate(source3); assert(candidate3?.id, 'Test 7 similar candidate')
  const similar = await reconcile(String(candidate3.id)); assert(similar.status === 'needs_review' && !similar.canonical_event_id, 'Test 7 similar is not same')
  const source4 = await ingest('reconciliation-test-04-unknown', 4); assert((await extract(source4)).status === 'needs_review', 'Test 8 unknown extraction is review')
  const candidate4 = await candidate(source4); assert(candidate4?.id && (await reconcile(String(candidate4.id))).status === 'needs_review', 'Test 8 unknown is review, not no event')
  const source5 = await ingest('reconciliation-test-05-no-event', 5); assert((await extract(source5)).status === 'no_event' && !await candidate(source5), 'Test 9 no event is distinct from unknown')
  const source6 = await ingest('reconciliation-test-06-newest', 6); assert((await extract(source6)).status === 'extracted', 'Test 10 newest extraction')
  const candidate6 = await candidate(source6); assert(candidate6?.id, 'Test 10 newest candidate')
  const newest = await reconcile(String(candidate6.id)); assert(newest.canonical_event_id === canonicalId, 'Test 10 newest source is not independently authoritative')
  const [runs, versions, provenance, reviews, sources] = await Promise.all([
    json<Array<Record<string, unknown>>>(`/rest/v1/event_reconciliation_runs?candidate_source_id=in.(${[source1, source2, source3, source4, source6].join(',')})&select=*`),
    json<Array<Record<string, unknown>>>(`/rest/v1/canonical_event_versions?canonical_event_id=eq.${canonicalId}&select=*`),
    json<Array<Record<string, unknown>>>(`/rest/v1/canonical_event_field_history?candidate_event_id=eq.${candidate1.id}&select=*`),
    json<Array<Record<string, unknown>>>(`/rest/v1/event_reconciliation_reviews?candidate_event_id=eq.${candidate3!.id}&select=*`),
    json<Array<Record<string, unknown>>>(`/rest/v1/sources?id=in.(${[source1, source2, source3, source4, source5, source6].join(',')})&select=id,status`),
  ])
  assert(runs.length === 5 && runs.every((run) => typeof run.status === 'string'), 'Test 11 exact reconciliation runs')
  assert(versions.length === 1 && provenance.length >= 2 && reviews.length === 1, 'Test 11 canonical version, provenance, and review inspection')
  assert(sources.length === 6 && sources.every((source) => source.status === 'active'), 'Test 12 reconciliation status never changes source lifecycle')
  console.log('Phase 8.1 acceptance Tests 1–12 passed. Run reconciliation:cleanup after inspection.')
}

const mode = process.argv[2]
if (mode === '--acceptance') await acceptance(); else if (mode === '--cleanup') await cleanup(); else throw new Error('Use --acceptance or --cleanup')

export {}
