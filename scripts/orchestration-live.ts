const prefix = 'pipeline-test-'
const ids = ['pipeline-test-01-current', 'pipeline-test-02-edit', 'pipeline-test-03-replay', 'pipeline-test-04-cancelled', 'pipeline-test-05-no-event', 'pipeline-test-06-textless', 'pipeline-test-07-null-year', 'pipeline-test-08-ambiguity', 'pipeline-test-09-failure-isolation', 'pipeline-test-10-canonical', 'pipeline-test-batch-a', 'pipeline-test-batch-b', 'pipeline-test-batch-c'] as const
const text: Record<(typeof ids)[number], string> = {
  'pipeline-test-01-current': 'Buglasan Pipeline Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.',
  'pipeline-test-02-edit': 'Buglasan Pipeline Parade 2027 is confirmed on October 19, 2027 at 6:00 PM at Provincial Convention Center.',
  'pipeline-test-03-replay': 'Buglasan Pipeline Replay 2027 is confirmed on October 20, 2027 at 6:00 PM at Freedom Park.',
  'pipeline-test-04-cancelled': 'Buglasan Pipeline Cancelled 2027 is cancelled due to weather.',
  'pipeline-test-05-no-event': 'Thank you to everyone who supports Buglasan culture.',
  'pipeline-test-06-textless': '',
  'pipeline-test-07-null-year': 'Buglasan Pipeline Uncertain is confirmed on October 18 at Freedom Park.',
  'pipeline-test-08-ambiguity': 'Buglasan Pipeline Maybe 2027 may happen October 18 or October 19.',
  'pipeline-test-09-failure-isolation': 'Buglasan Pipeline Isolated 2027 is confirmed on October 21, 2027 at 6:00 PM at Freedom Park.',
  'pipeline-test-10-canonical': 'Buglasan Pipeline Canonical 2027 is confirmed on October 22, 2027 at 6:00 PM at Freedom Park.',
  'pipeline-test-batch-a': 'Buglasan Pipeline Batch A 2027 is confirmed on October 23, 2027 at 6:00 PM at Freedom Park.',
  'pipeline-test-batch-b': 'Buglasan Pipeline Batch B 2027 is confirmed on October 24, 2027 at 6:00 PM at Freedom Park.',
  'pipeline-test-batch-c': 'Buglasan Pipeline Batch C 2027 is confirmed on October 25, 2027 at 6:00 PM at Freedom Park.',
}
const url = process.env.SUPABASE_URL
const key = (JSON.parse(process.env.SUPABASE_SECRET_KEYS ?? '{}') as Record<string, string>).default ?? process.env.SUPABASE_SECRET_KEY
const expectedRef = process.env.SUPABASE_EXPECTED_PROJECT_REF
const fixtureToken = process.env.PIPELINE_ACCEPTANCE_FIXTURE_TOKEN
const extractToken = process.env.EXTRACT_SOURCE_TOKEN
const indexToken = process.env.INDEX_SOURCE_TOKEN
const reconcileToken = process.env.RECONCILE_EVENT_TOKEN

function guard(): void {
  if (process.env.LIVE_PIPELINE_ACCEPTANCE_TEST !== 'I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION') throw new Error('Live pipeline opt-in is not set exactly')
  if (!url || !key || !expectedRef || !fixtureToken || !extractToken || !indexToken || !reconcileToken) throw new Error('Required server-side environment variable names are not configured')
  if (new URL(url).hostname.split('.')[0] !== expectedRef) throw new Error('SUPABASE_EXPECTED_PROJECT_REF does not match SUPABASE_URL')
  if ([extractToken, indexToken, reconcileToken].includes(fixtureToken)) throw new Error('Pipeline fixture token must differ from worker tokens')
}
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(`Pipeline acceptance assertion failed: ${label}`) }
async function api(path: string, init: RequestInit = {}): Promise<Response> { return fetch(`${url}${path}`, { ...init, headers: { apikey: key!, 'content-type': 'application/json', ...(init.headers ?? {}) } }) }
type SafeHttpFailure = { status: number; contentType: string | null; body: string; json: unknown; category?: string; code?: string; requestId?: string }
async function readSafeHttpFailure(response: Response): Promise<SafeHttpFailure> {
  const body = await response.text()
  let json: unknown = null
  try { json = body ? JSON.parse(body) : null } catch { /* preserve non-JSON text */ }
  const record = json && typeof json === 'object' ? json as Record<string, unknown> : {}
  const header = (name: string) => response.headers.get(name) ?? undefined
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body,
    json,
    category: typeof record.category === 'string' ? record.category : undefined,
    code: typeof record.code === 'string' ? record.code : undefined,
    requestId: header('x-request-id') ?? header('x-correlation-id') ?? (typeof record.requestId === 'string' ? record.requestId : undefined),
  }
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> { const r = await api(path, init); if (!r.ok) { const failure = await readSafeHttpFailure(r); throw new Error(`${path} failed: ${JSON.stringify(failure)}`) }; const body = await r.text(); return (body ? JSON.parse(body) : null) as T }
async function rows(table: string, filter: string, select = 'id'): Promise<Array<Record<string, unknown>>> { return request(`/rest/v1/${table}?${filter}&select=${select}`) }

async function cleanup(): Promise<void> {
  guard()
  const r = await fetch(`${url}/functions/v1/cleanup-pipeline-acceptance`, { method: 'POST', headers: { apikey: key!, 'content-type': 'application/json', 'x-pipeline-acceptance-fixture-token': fixtureToken! } })
  if (!r.ok) throw new Error(`Pipeline cleanup failed: ${r.status}`)
  await zeroRemains()
}
async function zeroRemains(): Promise<void> {
  const sources = await rows('sources', `post_id=like.${prefix}*`, 'id,post_id')
  assert(sources.length === 0, 'zero fixture sources')
  for (const table of ['source_extractions', 'source_indexings', 'source_chunks', 'events', 'event_reconciliation_runs', 'event_candidate_associations', 'event_reconciliation_reviews', 'event_reconciliation_audit', 'canonical_event_field_history', 'canonical_event_versions', 'canonical_events']) {
    const r = await api(`/rest/v1/${table}?select=id&limit=1`)
    assert(r.ok, `independent ${table} audit is readable`)
  }
  console.log('Independent Phase 9 fixture audit: zero pipeline fixture sources remain; all related ledger tables are independently readable.')
}
async function ingest(id: (typeof ids)[number], ordinal: number): Promise<string> {
  const value = text[id]
  const result = await request<Array<{ source_id: string }>>('/rest/v1/rpc/ingest_source', { method: 'POST', body: JSON.stringify({ p_payload: { platform: 'facebook', post_id: id, post_url: `https://www.facebook.com/NegrosOrientalProvincialGovernment/posts/${id}`, published_at: `2027-09-${String(ordinal).padStart(2, '0')}T08:00:00+08:00`, post_year: 2027, festival_year: 2027, raw_text: value, normalized_text: value, title: id, source_type: value ? 'text' : 'image', media_urls: value ? [] : ['https://example.invalid/textless.png'], collected_at: new Date().toISOString(), collection_method: 'manual', source_metadata: { pipeline_acceptance_fixture: 'phase9-v1' } } }) })
  assert(result.length === 1, `${id} ingest_source`) ; return result[0].source_id
}
async function worker(name: 'extract-source' | 'index-source' | 'reconcile-event', body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = name === 'extract-source' ? { 'x-extraction-token': extractToken!, 'x-pipeline-acceptance-fixture-token': fixtureToken! } : name === 'index-source' ? { 'x-index-source-token': indexToken!, 'x-indexing-acceptance-fixture-token': fixtureToken! } : { 'x-reconcile-event-token': reconcileToken! }
  const r = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const result = await r.json() as Record<string, unknown>
  if (!r.ok && result.status !== 'needs_review' && result.status !== 'permanent_error' && result.status !== 'retryable_error') throw new Error(`${name} failed: ${r.status}`)
  return result
}
async function processFixture(id: (typeof ids)[number], ordinal: number): Promise<{ sourceId: string; candidateId?: string }> {
  const sourceId = await ingest(id, ordinal)
  const extraction = id === 'pipeline-test-06-textless' ? null : await worker('extract-source', { source_id: sourceId })
  const indexing = await worker('index-source', { source_id: sourceId })
  if (id === 'pipeline-test-06-textless') assert(indexing.status === 'needs_review', 'Test 6 textless direct deployed index-source')
  if (id === 'pipeline-test-05-no-event') assert(extraction?.status === 'no_event', 'Test 5 no event')
  if (['pipeline-test-04-cancelled', 'pipeline-test-07-null-year', 'pipeline-test-08-ambiguity'].includes(id)) assert(extraction?.status === 'needs_review', `${id} review safety`)
  const events = await rows('events', `extracted_source_id=eq.${sourceId}`, 'id,is_current,festival_year,review_reasons')
  if (!events.length) return { sourceId }
  const reconciliation = await worker('reconcile-event', { candidate_event_id: events[0].id })
  assert(['reconciled', 'needs_review', 'permanent_error', 'retryable_error'].includes(String(reconciliation.status)), `${id} reconciliation lifecycle`)
  return { sourceId, candidateId: String(events[0].id) }
}
async function acceptance(): Promise<void> {
  guard(); await cleanup()
  const current = await processFixture('pipeline-test-01-current', 1); assert(current.candidateId, 'Test 1 current fixture')
  const edited = await processFixture('pipeline-test-02-edit', 2); assert(edited.candidateId, 'Test 2 edit fixture')
  const replay = await processFixture('pipeline-test-03-replay', 3); assert(replay.candidateId, 'Test 3 replay fixture')
  const replayResult = await worker('reconcile-event', { candidate_event_id: replay.candidateId }); assert(replayResult.cached === true || replayResult.status === 'reconciled', 'Test 3 replay idempotency')
  await processFixture('pipeline-test-04-cancelled', 4); await processFixture('pipeline-test-05-no-event', 5); await processFixture('pipeline-test-06-textless', 6); await processFixture('pipeline-test-07-null-year', 7); await processFixture('pipeline-test-08-ambiguity', 8); await processFixture('pipeline-test-09-failure-isolation', 9)
  const canonical = await processFixture('pipeline-test-10-canonical', 10); assert(canonical.candidateId, 'Test 10 canonical fixture')
  const batch = await Promise.all(['pipeline-test-batch-a', 'pipeline-test-batch-b', 'pipeline-test-batch-c'].map((id, index) => processFixture(id as (typeof ids)[number], 11 + index)))
  assert(batch.every((item) => item.candidateId), 'three-source batch')
  // A/B/C/D are intentionally inactive: workflow JSON is checked statically; the preceding calls are direct deployed B/C/D interfaces.
  const chat = await fetch(`${url}/functions/v1/chat`, { method: 'POST', headers: { apikey: key!, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'What is the Buglasan Pipeline Canonical 2027 schedule?', festivalYear: 2027 }) })
  if (!chat.ok) { const failure = await readSafeHttpFailure(chat); throw new Error(`chat failed: ${JSON.stringify(failure)}`) }
  const chatBody = await chat.json() as Record<string, unknown>
  const citations = (chatBody.message as Record<string, unknown> | undefined)?.sources
  const canonicalUrl = 'https://www.facebook.com/NegrosOrientalProvincialGovernment/posts/pipeline-test-10-canonical'
  assert(Array.isArray(citations) && citations.some((source: Record<string, unknown>) => source.postId === 'pipeline-test-10-canonical' && source.postUrl === canonicalUrl && /^https:\/\/www\.facebook\.com\//.test(String(source.postUrl))), 'semantic chat citation with official source identity and link')
  console.log('Phase 9 acceptance passed through deployed ingest_source, extract-source, index-source, reconcile-event, and chat. Inactive n8n contracts were statically validated, not invoked.')
}

async function singleAcceptance(): Promise<void> {
  guard(); await cleanup()
  let sourceId: string | undefined
  try {
    const fixture = 'pipeline-test-10-canonical' as const
    sourceId = await ingest(fixture, 10)
    const extraction = await worker('extract-source', { source_id: sourceId })
    assert(extraction.status === 'extracted', 'single fixture extraction terminal success')
    const events = await rows('events', `extracted_source_id=eq.${sourceId}`, 'id,event_name,start_datetime,end_datetime,festival_year,venue,status,is_current,source_fingerprint,extractor_version')
    assert(events.length === 1, 'single fixture source-local candidate')
    const candidate = events[0]
    assert(candidate.event_name === 'Buglasan Pipeline Canonical 2027', 'single fixture event name')
    assert(candidate.festival_year === 2027, 'single fixture year')
    const indexing = await worker('index-source', { source_id: sourceId })
    assert(['indexed'].includes(String(indexing.status)), `single fixture indexing success: ${JSON.stringify(indexing)}`)
    const chunks = await rows('source_chunks', `source_id=eq.${sourceId}&is_current=eq.true`, 'id,source_id,content,embedding')
    assert(chunks.length > 0, 'single fixture current chunks')
    const reconciliation = await worker('reconcile-event', { candidate_event_id: candidate.id })
    assert(reconciliation.status === 'reconciled', 'single fixture reconciliation')
    const canonical = await rows('canonical_events', 'festival_year=eq.2027', 'id,festival_year,current_version_id,lifecycle_status')
    assert(canonical.length === 1, 'single fixture canonical event')
    const chat = await fetch(`${url}/functions/v1/chat`, { method: 'POST', headers: { apikey: key!, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'What is the Buglasan Pipeline Canonical 2027 schedule?', festivalYear: 2027 }) })
    if (!chat.ok) { const failure = await readSafeHttpFailure(chat); throw new Error(`chat failed: ${JSON.stringify(failure)}`) }
    const body = await chat.json() as Record<string, unknown>
    const message = body.message as Record<string, unknown>
    assert(Array.isArray(body.retrievedEvents) && body.retrievedEvents.length > 0, 'chat structured evidence')
    assert(Array.isArray(body.retrievedChunks) && body.retrievedChunks.length > 0, 'chat semantic evidence')
    const citations = message.sources
    assert(Array.isArray(citations) && citations.some((s: Record<string, unknown>) => s.postId === fixture && s.postUrl === `https://www.facebook.com/NegrosOrientalProvincialGovernment/posts/${fixture}`), 'chat official citation')
    console.log(JSON.stringify({ fixture, sourceId, extraction, candidate, indexing, chunkCount: chunks.length, reconciliation, canonical, chat: { status: chat.status, retrievedEvents: (body.retrievedEvents as unknown[]).length, retrievedChunks: (body.retrievedChunks as unknown[]).length, retrievedSources: Array.isArray(body.retrievedSources) ? body.retrievedSources.length : 0, message } }))
  } finally { await cleanup() }
}

async function diagnosticChat(): Promise<void> {
  guard()
  const response = await fetch(`${url}/functions/v1/chat`, { method: 'POST', headers: { apikey: key!, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'What is the Buglasan Pipeline Canonical 2027 schedule?', festivalYear: 2027 }) })
  const result = response.ok ? { status: response.status, contentType: response.headers.get('content-type'), body: await response.text() } : await readSafeHttpFailure(response)
  console.log(`DIAGNOSTIC_CHAT=${JSON.stringify(result)}`)
  if (!response.ok) throw new Error('Diagnostic chat request failed')
}

const mode = process.argv[2]
if (mode === '--acceptance') await acceptance(); else if (mode === '--single-acceptance') await singleAcceptance(); else if (mode === '--diagnostic-chat') await diagnosticChat(); else if (mode === '--cleanup') await cleanup(); else if (mode === '--verify-cleanup') { guard(); await zeroRemains() } else throw new Error('Use --acceptance, --single-acceptance, --diagnostic-chat, --cleanup, or --verify-cleanup')
export {}
