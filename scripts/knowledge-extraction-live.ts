import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const prefix = 'extraction-test-'
const mode = process.argv[2]
const url = process.env.SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const expectedRef = process.env.SUPABASE_EXPECTED_PROJECT_REF
const optIn = process.env.LIVE_KNOWLEDGE_EXTRACTION_TEST
const token = process.env.EXTRACT_SOURCE_TOKEN
const acceptanceFixtureToken = process.env.EXTRACTION_ACCEPTANCE_FIXTURE_TOKEN
type Fixture = { id: string; source: string; expect: string }
type IngestResult = { source_id: string; operation: string; changed: boolean }

function guard(): void {
  if (optIn !== 'I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION') throw new Error('Live knowledge extraction opt-in is not set')
  if (!url || !secretKey || !expectedRef || !token) throw new Error('Required server-side environment variable names are not configured')
  const actualRef = new URL(url).hostname.split('.')[0]
  if (actualRef !== expectedRef) throw new Error('SUPABASE_EXPECTED_PROJECT_REF does not match SUPABASE_URL')
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}${path}`, { ...init, headers: { apikey: secretKey!, 'content-type': 'application/json', ...(init.headers ?? {}) } })
}

async function cleanup(): Promise<void> {
  guard()
  const scoped = await api(`/rest/v1/sources?post_id=like.${prefix}*&select=id,post_id`)
  if (!scoped.ok) throw new Error(`Narrow cleanup lookup failed: ${scoped.status}`)
  const rows = await scoped.json() as Array<{ id: string; post_id: string }>
  if (rows.some((row) => !row.post_id.startsWith(prefix))) throw new Error('Cleanup scope invariant failed')
  if (!rows.length) return console.log('No extraction-test-* fixtures to remove.')
  const ids = rows.map((row) => row.id).join(',')
  // extracted_source_id is ON DELETE RESTRICT so remove only fixture-derived events first.
  const events = await api(`/rest/v1/events?extracted_source_id=in.(${ids})`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
  if (!events.ok) throw new Error(`Narrow fixture event cleanup failed: ${events.status}`)
  const result = await api(`/rest/v1/sources?id=in.(${ids})`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
  if (!result.ok) throw new Error(`Narrow cleanup failed: ${result.status}`)
  console.log(`Removed ${rows.length} exact extraction-test-* fixture source IDs and only their derived events/state/provenance.`)
}

async function ingest(fixture: Fixture, index: number, source = fixture.source): Promise<IngestResult> {
  const fingerprint = createHash('sha256').update(source).digest('hex')
  const collected = await api('/rest/v1/rpc/ingest_source', { method: 'POST', body: JSON.stringify({ p_payload: {
    platform: 'facebook', post_id: fixture.id, post_url: `https://www.facebook.com/extraction-tests/${index + 1}`,
    published_at: '2026-09-05T08:00:00+08:00', post_year: 2026, festival_year: null,
    raw_text: source, normalized_text: source, title: fixture.id, source_type: 'text', media_urls: [],
    collected_at: new Date().toISOString(), collection_method: 'manual', source_metadata: { acceptance: true, fingerprint },
  } }) })
  if (!collected.ok) throw new Error(`Fixture ${fixture.id} ingestion failed: ${collected.status}`)
  return (await collected.json() as IngestResult[])[0]
}

async function extract(sourceId: string): Promise<Record<string, unknown>> {
  const result = await fetch(`${url}/functions/v1/extract-source`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-extraction-token': token!, ...(acceptanceFixtureToken ? { 'x-acceptance-fixture-token': acceptanceFixtureToken } : {}) }, body: JSON.stringify({ source_id: sourceId }) })
  const body = await result.json() as Record<string, unknown>
  if (!result.ok && body.status !== 'retryable_error' && body.status !== 'permanent_error') throw new Error(`Extraction HTTP ${result.status}`)
  return body
}

async function audit(sourceId: string): Promise<{ states: Array<Record<string, unknown>>; events: Array<Record<string, unknown>>; links: Array<Record<string, unknown>> }> {
  const statesResponse = await api(`/rest/v1/source_extractions?source_id=eq.${sourceId}&select=id,source_id,source_fingerprint,extractor_version,status&order=created_at.asc`)
  const eventsResponse = await api(`/rest/v1/events?extracted_source_id=eq.${sourceId}&select=id,extraction_identity,source_fingerprint,is_current&order=candidate_index.asc`)
  const linksResponse = await api(`/rest/v1/event_sources?source_id=eq.${sourceId}&select=event_id,source_id`)
  if (!statesResponse.ok || !eventsResponse.ok || !linksResponse.ok) throw new Error(`Scoped audit failed for ${sourceId}`)
  return { states: await statesResponse.json(), events: await eventsResponse.json(), links: await linksResponse.json() }
}

async function acceptance(): Promise<void> {
  guard()
  const fixtures = JSON.parse(readFileSync(new URL('../test/fixtures/extraction-test-cases.json', import.meta.url), 'utf8')) as Fixture[]
  if (fixtures.length !== 9) throw new Error('Expected deterministic fixtures A-I')
  const sourceIds: string[] = []
  for (const [index, fixture] of fixtures.entries()) {
    const { source_id: sourceId } = await ingest(fixture, index)
    sourceIds.push(sourceId)
    const body = await extract(sourceId)
    if (body.status !== fixture.expect) throw new Error(`Test ${index + 1} expected ${fixture.expect}, received ${String(body.status)}`)
    const scoped = await audit(sourceId)
    if (scoped.states.length !== 1 || scoped.states[0].status !== fixture.expect) throw new Error(`Test ${index + 1} extraction state mismatch`)
    if ((!body.cached && scoped.events.length !== Number(body.persisted_candidates ?? 0)) || scoped.links.length !== scoped.events.length) throw new Error(`Test ${index + 1} event/link count mismatch`)
    if (scoped.events.some((event) => !event.is_current || typeof event.extraction_identity !== 'string')) throw new Error(`Test ${index + 1} event identity/current mismatch`)
    console.log(`Test ${index + 1}: ${fixture.id} -> ${body.status}`)
  }
  // Test 10 invokes the exact same unchanged source and proves identity/count idempotency.
  const replayId = sourceIds[0]
  const before = await audit(replayId)
  const unchanged = await ingest(fixtures[0], 0)
  if (unchanged.source_id !== replayId || unchanged.changed || unchanged.operation !== 'unchanged') throw new Error('Test 10 did not ingest the exact unchanged source')
  const replay = await extract(replayId)
  if (replay.status !== fixtures[0].expect || replay.cached !== true) throw new Error('Test 10 endpoint replay was not cached')
  const after = await audit(replayId)
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Test 10 replay changed scoped state/event/link identity')

  // Deterministic edit behavior: same source ID, new fingerprint/state, old events retained only as inactive audit rows.
  const editedText = `${fixtures[0].source} Updated venue: Provincial Convention Center.`
  const edited = await ingest(fixtures[0], 0, editedText)
  if (edited.source_id !== replayId || !edited.changed || edited.operation !== 'updated') throw new Error('Edit did not update the same source')
  await extract(replayId)
  const editedAudit = await audit(replayId)
  if (editedAudit.states.length !== 2) throw new Error('Edit did not create one new fingerprint-scoped state')
  const activeFingerprints = new Set(editedAudit.events.filter((event) => event.is_current).map((event) => event.source_fingerprint))
  if (activeFingerprints.size > 1 || editedAudit.events.filter((event) => event.is_current).some((event) => event.source_fingerprint === before.states[0].source_fingerprint)) throw new Error('Old fingerprint events remained active after replacement')
  console.log('Test 10: exact replay preserved counts/identity; source edit replaced active output source-locally. Run cleanup separately.')
}

if (mode === '--acceptance') await acceptance()
else if (mode === '--cleanup') await cleanup()
else throw new Error('Use --acceptance or --cleanup')
