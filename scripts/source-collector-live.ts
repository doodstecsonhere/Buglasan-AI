/** Live-safe Phase 5 acceptance harness. Calls only ingest_source for writes. */
import process from 'node:process'
import fixturesJson from '../test/fixtures/source-ingestion.json' with { type: 'json' }
import { normalizeSourceIngestionPayload, type SourceIngestionPayload } from '../src/ingestion/sourceIngestion.ts'
import { assert, assertLiveSafety } from './smoke-test-helpers.ts'

try { process.loadEnvFile('.env.local') } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const FIXTURE_IDS = ['ingestion-test-a', 'ingestion-test-b', 'ingestion-test-c', 'ingestion-test-d'] as const
const args = new Set(process.argv.slice(2))
const cleanupOnly = args.has('--cleanup')
const acceptance = args.has('--acceptance')
assert(cleanupOnly !== acceptance, 'Choose exactly one mode: --acceptance or --cleanup')
const { projectRef } = assertLiveSafety(process.env, 'LIVE_SOURCE_COLLECTOR_TEST')
const supabaseUrl = requiredEnv('SUPABASE_URL')
const secretKey = requiredEnv('SUPABASE_SECRET_KEY')

type Json = Record<string, unknown>
const fixtures = Object.fromEntries(Object.entries(fixturesJson).map(([key, value]) => [key, normalizeSourceIngestionPayload(value)])) as Record<'A' | 'B' | 'C' | 'D' | 'E', SourceIngestionPayload>

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function headers(extra: HeadersInit = {}): HeadersInit {
  return { apikey: secretKey, 'Content-Type': 'application/json', ...extra }
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${supabaseUrl}${path}`, { ...init, headers: headers(init.headers) })
  const text = await response.text()
  if (!response.ok) throw new Error(`Supabase request failed at ${path} (${response.status}): ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

async function cleanup(): Promise<void> {
  const encoded = encodeURIComponent(`(${FIXTURE_IDS.join(',')})`)
  // Fixed exact post IDs only: never deletes by a broad user-supplied prefix.
  await request(`/rest/v1/sources?platform=eq.facebook&post_id=in.${encoded}`, { method: 'DELETE' })
}

async function ingest(payload: SourceIngestionPayload): Promise<Json> {
  const result = await request('/rest/v1/rpc/ingest_source', { method: 'POST', body: JSON.stringify({ p_payload: payload }) })
  assert(Array.isArray(result) && result.length === 1, 'ingest_source must return one compact row')
  return result[0] as Json
}

async function readRows(): Promise<Json[]> {
  const ids = encodeURIComponent(`(${FIXTURE_IDS.join(',')})`)
  const columns = 'id,platform,post_id,published_at,post_year,festival_year,raw_text,normalized_text,title,source_type,media_urls,collected_at,collection_method,source_metadata,content_fingerprint,ingested_at,updated_at'
  const result = await request(`/rest/v1/sources?platform=eq.facebook&post_id=in.${ids}&select=${columns}&order=post_id.asc`, { method: 'GET' })
  assert(Array.isArray(result), 'fixture row query must return an array')
  return result as Json[]
}

function expectResult(row: Json, operation: string, changed: boolean): void {
  assert(row.operation === operation, `expected ${operation}, received ${String(row.operation)}`)
  assert(row.changed === changed, `expected changed=${changed}`)
  assert(typeof row.source_id === 'string' && typeof row.post_id === 'string', 'RPC result must identify source and post')
}

async function runAcceptance(): Promise<void> {
  await cleanup()
  try {
    const test1 = await ingest(fixtures.A)
    expectResult(test1, 'inserted', true)
    const initial = (await readRows()).find((row) => row.post_id === fixtures.A.post_id)!

    const test2 = await ingest({ ...fixtures.A, collected_at: '2026-09-06T00:00:00.000Z' })
    expectResult(test2, 'unchanged', false)
    const replay = (await readRows()).find((row) => row.post_id === fixtures.A.post_id)!
    assert(replay.id === initial.id && replay.ingested_at === initial.ingested_at && replay.updated_at === initial.updated_at, 'exact replay must preserve identity and server timestamps')
    assert(replay.collected_at === initial.collected_at, 'collection-time noise must not mutate the row')

    expectResult(await ingest(fixtures.B), 'inserted', true)
    expectResult(await ingest(fixtures.C), 'inserted', true)
    expectResult(await ingest(fixtures.D), 'inserted', true)
    const four = await readRows()
    assert(four.length === 4, `expected exactly 4 fixture identities, received ${four.length}`)
    const b = four.find((row) => row.post_id === fixtures.B.post_id)!
    const c = four.find((row) => row.post_id === fixtures.C.post_id)!
    const d = four.find((row) => row.post_id === fixtures.D.post_id)!
    assert(b.post_year === 2026 && b.festival_year === 2027, 'Test 3: publication and festival years must remain distinct')
    assert(c.published_at === null && c.festival_year === null, 'Test 4: unknown publication/festival fields must stay null')
    assert(d.raw_text === null && d.normalized_text === null && Array.isArray(d.media_urls) && d.media_urls.length === 2, 'Test 5: image-only source must preserve null text and media')

    const test6 = await ingest(fixtures.E)
    expectResult(test6, 'updated', true)
    const editedRows = await readRows()
    const edited = editedRows.find((row) => row.post_id === fixtures.A.post_id)!
    assert(editedRows.length === 4 && edited.id === initial.id && edited.ingested_at === initial.ingested_at, 'edit must preserve count, source ID, and initial ingestion time')
    assert(edited.updated_at !== initial.updated_at && edited.raw_text === fixtures.E.raw_text, 'edit must update semantic fields and updated_at')
    assert(editedRows.every((row) => typeof row.content_fingerprint === 'string' && /^[a-f0-9]{64}$/.test(row.content_fingerprint as string)), 'all collector rows need SHA-256 fingerprints')
    console.log(`Source collector acceptance Tests 1-6 passed in project ${projectRef}; 4 deterministic fixture identities verified.`)
  } finally {
    await cleanup()
    console.log('Deterministic source collector fixtures cleaned.')
  }
}

if (cleanupOnly) {
  await cleanup()
  console.log(`Cleanup passed for ${FIXTURE_IDS.length} deterministic source fixture identities in project ${projectRef}.`)
} else {
  await runAcceptance()
}
