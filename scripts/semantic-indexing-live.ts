import { createHash } from 'node:crypto'

const prefix = 'indexing-test-'
const mode = process.argv[2]
const url = process.env.SUPABASE_URL
const expectedRef = process.env.SUPABASE_EXPECTED_PROJECT_REF
const optIn = process.env.LIVE_SEMANTIC_INDEXING_TEST
const indexToken = process.env.INDEX_SOURCE_TOKEN
const fixtureToken = process.env.INDEXING_ACCEPTANCE_FIXTURE_TOKEN
const secretKeys = JSON.parse(process.env.SUPABASE_SECRET_KEYS ?? '{}') as Record<string, string>
const secretKey = secretKeys.default

type Fixture = { postId: string; text: string; media: string[]; expected: string }
type IngestResult = { source_id: string; operation: string; changed: boolean }
const fixtures: Fixture[] = [
  { postId: `${prefix}text`, text: 'Buglasan Festival activities open at Freedom Park on October 18, 2026.', media: [], expected: 'indexed' },
  { postId: `${prefix}empty`, text: '', media: [], expected: 'no_text' },
  { postId: `${prefix}image`, text: '', media: ['https://example.invalid/indexing-fixture.png'], expected: 'needs_review' },
]

function guard(): void {
  if (optIn !== 'I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION') throw new Error('Live semantic indexing opt-in is not set')
  if (!url || !secretKey || !expectedRef || !indexToken || !fixtureToken) throw new Error('Required server-side environment variable names are not configured')
  if (indexToken === fixtureToken) throw new Error('Acceptance fixture token must be distinct from the production index token')
  if (new URL(url).hostname.split('.')[0] !== expectedRef) throw new Error('SUPABASE_EXPECTED_PROJECT_REF does not match SUPABASE_URL')
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}${path}`, { ...init, headers: { apikey: secretKey!, 'content-type': 'application/json', ...(init.headers ?? {}) } })
}

async function scopedRows(select = 'id,post_id'): Promise<Array<Record<string, unknown>>> {
  const response = await api(`/rest/v1/sources?post_id=like.${prefix}*&select=${select}`)
  if (!response.ok) throw new Error(`Scoped fixture lookup failed: ${response.status}`)
  const rows = await response.json() as Array<Record<string, unknown>>
  if (rows.some((row) => typeof row.post_id !== 'string' || !row.post_id.startsWith(prefix))) throw new Error('Fixture scope invariant failed')
  return rows
}

async function cleanup(): Promise<void> {
  guard()
  const rows = await scopedRows()
  const ids = rows.map((row) => String(row.id))
  if (ids.length) {
    const idFilter = ids.join(',')
    // Child-first cleanup: chunks, indexing audit records, then exact prefix-scoped sources.
    for (const path of [`/rest/v1/source_chunks?source_id=in.(${idFilter})`, `/rest/v1/source_indexings?source_id=in.(${idFilter})`, `/rest/v1/sources?id=in.(${idFilter})`]) {
      const response = await api(path, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
      if (!response.ok) throw new Error(`Scoped cleanup failed: ${response.status}`)
    }
  }
  const remains = await scopedRows()
  if (remains.length !== 0) throw new Error(`Cleanup verification failed: ${remains.length} fixture sources remain`)
  console.log(`Semantic indexing cleanup verified zero remains after removing ${rows.length} exact fixtures.`)
}

async function ingest(fixture: Fixture, index: number, text = fixture.text): Promise<IngestResult> {
  const fingerprint = createHash('sha256').update(text).digest('hex')
  const response = await api('/rest/v1/rpc/ingest_source', { method: 'POST', body: JSON.stringify({ p_payload: {
    platform: 'facebook', post_id: fixture.postId, post_url: `https://www.facebook.com/indexing-tests/${index + 1}`,
    published_at: '2026-09-05T08:00:00+08:00', post_year: 2026, festival_year: 2026,
    raw_text: text, normalized_text: text, title: fixture.postId, source_type: fixture.media.length ? 'image' : 'text', media_urls: fixture.media,
    collected_at: new Date().toISOString(), collection_method: 'manual', source_metadata: { acceptance: true, fingerprint },
  } }) })
  if (!response.ok) throw new Error(`Fixture ${fixture.postId} ingestion failed: ${response.status}`)
  return (await response.json() as IngestResult[])[0]
}

async function index(sourceId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}/functions/v1/index-source`, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-index-source-token': indexToken!, 'x-indexing-acceptance-fixture-token': fixtureToken!,
  }, body: JSON.stringify({ source_id: sourceId }) })
  const body = await response.json() as Record<string, unknown>
  if (!response.ok && body.status !== 'retryable_error' && body.status !== 'permanent_error') throw new Error(`Index HTTP ${response.status}`)
  return body
}

async function audit(sourceId: string): Promise<{ states: Array<Record<string, unknown>>; chunks: Array<Record<string, unknown>> }> {
  const states = await api(`/rest/v1/source_indexings?source_id=eq.${sourceId}&select=id,source_fingerprint,status,chunk_count&order=created_at.asc`)
  const chunks = await api(`/rest/v1/source_chunks?source_id=eq.${sourceId}&select=id,source_fingerprint,chunk_index,content_hash,is_current&order=created_at.asc`)
  if (!states.ok || !chunks.ok) throw new Error(`Scoped audit failed for ${sourceId}`)
  return { states: await states.json(), chunks: await chunks.json() }
}

async function acceptance(): Promise<void> {
  guard()
  await cleanup()
  const ids: string[] = []
  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const ingested = await ingest(fixture, fixtureIndex)
    ids.push(ingested.source_id)
    const result = await index(ingested.source_id)
    if (result.status !== fixture.expected) throw new Error(`Fixture ${fixture.postId} expected ${fixture.expected}, received ${String(result.status)}`)
    const state = await audit(ingested.source_id)
    if (state.states.length !== 1 || state.states[0].status !== fixture.expected) throw new Error(`Fixture ${fixture.postId} indexing state mismatch`)
    if (fixture.expected === 'indexed' ? !state.chunks.some((chunk) => chunk.is_current === true) : state.chunks.some((chunk) => chunk.is_current === true)) throw new Error(`Fixture ${fixture.postId} current chunk mismatch`)
  }
  const before = await audit(ids[0])
  const replay = await index(ids[0])
  if (replay.cached !== true || JSON.stringify(await audit(ids[0])) !== JSON.stringify(before)) throw new Error('Exact replay did not preserve cached identities and counts')
  const edited = await ingest(fixtures[0], 0, `${fixtures[0].text} Updated venue: Provincial Convention Center.`)
  if (edited.source_id !== ids[0] || edited.operation !== 'updated' || !edited.changed) throw new Error('Canonical edit did not update the same source ID')
  const editedResult = await index(ids[0])
  if (editedResult.status !== 'indexed') throw new Error('Edited fixture was not indexed')
  const after = await audit(ids[0])
  if (after.states.length !== 2 || after.chunks.filter((chunk) => chunk.is_current).some((chunk) => chunk.source_fingerprint === before.states[0].source_fingerprint)) throw new Error('Edited fixture did not atomically replace current chunks')
  console.log('Six semantic indexing checks passed: text, no-text, image-only, exact replay, canonical edit, and current replacement. Run cleanup separately.')
}

if (mode === '--acceptance') await acceptance()
else if (mode === '--cleanup') await cleanup()
else throw new Error('Use --acceptance or --cleanup')
