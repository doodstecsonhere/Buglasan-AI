/**
 * Development-only LIVE RAG temporal-isolation smoke harness.
 * It never runs unless the exact opt-in and target-project checks pass.
 */
import process from 'node:process'
import {
  EMBEDDING_DIMENSION,
  SMOKE_PREFIX,
  assertAcceptanceAnswer,
  assert,
  assertLiveSafety,
  assertOnlyYear,
  extractCitations,
  normalizeEmbedding,
} from './smoke-test-helpers.ts'

process.loadEnvFile('.env.local')

type Json = Record<string, unknown>
type Fixture = {
  year: 2025 | 2026
  sourceId: string
  chunkId: string
  eventId: string
  postId: string
  postUrl: string
  text: string
  eventName: string
  start: string
  end: string
  publishedAt: string
}

const FIXTURES: readonly Fixture[] = [
  {
    year: 2025,
    sourceId: '00000000-0000-4000-8000-000000002025',
    chunkId: '20000000-0000-4000-8000-000000002025',
    eventId: '10000000-0000-4000-8000-000000002025',
    postId: `${SMOKE_PREFIX}rag-temporal-2025`,
    postUrl: 'https://smoke-test.invalid/buglasan/rag-temporal-2025',
    text: 'TEST FIXTURE ONLY. The Buglasan Chess Tournament 2025 will be held on October 16, 2025 at 9:00 AM at the Negros Oriental Convention Center.',
    eventName: 'Buglasan Chess Tournament 2025',
    start: '2025-10-16T09:00:00+08:00',
    end: '2025-10-16T10:00:00+08:00',
    publishedAt: '2025-10-01T09:00:00+08:00',
  },
  {
    year: 2026,
    sourceId: '00000000-0000-4000-8000-000000002026',
    chunkId: '20000000-0000-4000-8000-000000002026',
    eventId: '10000000-0000-4000-8000-000000002026',
    postId: `${SMOKE_PREFIX}rag-temporal-2026`,
    postUrl: 'https://smoke-test.invalid/buglasan/rag-temporal-2026',
    text: 'TEST FIXTURE ONLY. The Buglasan Chess Tournament 2026 will be held on October 21, 2026 at 10:00 AM at the Negros Oriental Convention Center.',
    eventName: 'Buglasan Chess Tournament 2026',
    start: '2026-10-21T10:00:00+08:00',
    end: '2026-10-21T11:00:00+08:00',
    publishedAt: '2026-10-01T10:00:00+08:00',
  },
] as const

const args = new Set(process.argv.slice(2))
const cleanupOnly = args.has('--cleanup')
const acceptance = args.has('--acceptance')
assert(cleanupOnly !== acceptance, 'Choose exactly one mode: --acceptance or --cleanup')
const { projectRef } = assertLiveSafety(process.env)

const supabaseUrl = process.env.SUPABASE_URL!
const secretKey = process.env.SUPABASE_SECRET_KEY
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
const geminiKey = process.env.GEMINI_API_KEY
assert(secretKey, 'SUPABASE_SECRET_KEY is required for fixture writes')
if (acceptance) {
  assert(publishableKey, 'SUPABASE_PUBLISHABLE_KEY is required for the deployed chat call')
  assert(geminiKey, 'GEMINI_API_KEY is required to create RETRIEVAL_DOCUMENT fixtures and verify RPC retrieval')
}

function headers(key: string, extra: HeadersInit = {}): HeadersInit {
  return { apikey: key, 'Content-Type': 'application/json', ...extra }
}

async function request(path: string, init: RequestInit, key = secretKey!): Promise<unknown> {
  const response = await fetch(`${supabaseUrl}${path}`, { ...init, headers: headers(key, init.headers) })
  const text = await response.text()
  if (!response.ok) throw new Error(`Supabase request failed at ${path} (${response.status}): ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

async function embed(text: string, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[]> {
  const model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001'
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] }, taskType, outputDimensionality: EMBEDDING_DIMENSION }),
  })
  const body = await response.json() as Json
  if (!response.ok) throw new Error(`Gemini embedding failed (${response.status}); response intentionally omitted`)
  return normalizeEmbedding((body.embedding as Json | undefined)?.values)
}

async function cleanup(): Promise<void> {
  const sourceIds = FIXTURES.map((fixture) => fixture.sourceId)
  const eventIds = FIXTURES.map((fixture) => fixture.eventId)
  const inList = (values: string[]) => `(${values.join(',')})`
  // Explicit dependent deletes make the scope auditable; fixed IDs prevent broad prefix deletion.
  await request(`/rest/v1/event_sources?source_id=in.${encodeURIComponent(inList(sourceIds))}`, { method: 'DELETE' })
  await request(`/rest/v1/source_chunks?source_id=in.${encodeURIComponent(inList(sourceIds))}`, { method: 'DELETE' })
  await request(`/rest/v1/events?id=in.${encodeURIComponent(inList(eventIds))}`, { method: 'DELETE' })
  await request(`/rest/v1/sources?id=in.${encodeURIComponent(inList(sourceIds))}`, { method: 'DELETE' })
  console.log(`Cleanup passed for ${FIXTURES.length} deterministic smoke fixtures in project ${projectRef}.`)
}

async function upsert(table: string, rows: Json[], conflict: string): Promise<void> {
  await request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  })
}

async function seed(): Promise<void> {
  const embeddings = await Promise.all(FIXTURES.map((fixture) => embed(fixture.text, 'RETRIEVAL_DOCUMENT')))
  await upsert('sources', FIXTURES.map((fixture) => ({
    id: fixture.sourceId, platform: 'official', post_id: fixture.postId, post_url: fixture.postUrl,
    published_at: fixture.publishedAt, festival_year: fixture.year, raw_text: fixture.text,
    normalized_text: fixture.text, status: 'active', supersedes_source_id: null,
  })), 'platform,post_id')
  await upsert('source_chunks', FIXTURES.map((fixture, index) => ({
    id: fixture.chunkId, source_id: fixture.sourceId, chunk_index: 0, content: fixture.text, embedding: embeddings[index],
    metadata: { smoke_test: true, fixture_year: fixture.year, embedding_task: 'RETRIEVAL_DOCUMENT' },
  })), 'source_id,chunk_index')
  await upsert('events', FIXTURES.map((fixture) => ({
    id: fixture.eventId, event_name: fixture.eventName, aliases: [], description: fixture.text,
    category: 'other', start_datetime: fixture.start, end_datetime: fixture.end,
    venue: 'Negros Oriental Convention Center', organizer: 'Smoke Test Harness', status: 'confirmed', festival_year: fixture.year,
  })), 'id')
  await upsert('event_sources', FIXTURES.map((fixture) => ({ event_id: fixture.eventId, source_id: fixture.sourceId, relevance_score: 1 })), 'event_id,source_id')
}

async function directRpc(query: string, year: number): Promise<Json[]> {
  const queryEmbedding = await embed(query, 'RETRIEVAL_QUERY')
  const result = await request('/rest/v1/rpc/search_source_chunks', {
    method: 'POST',
    body: JSON.stringify({ query_embedding: queryEmbedding, target_festival_year: year, match_threshold: 0.7, match_count: 10 }),
  })
  assert(Array.isArray(result), 'search_source_chunks must return an array')
  return result as Json[]
}

async function callChat(message: string, festivalYear?: number): Promise<Json> {
  const body: Json = { message, language: 'en', history: [] }
  if (festivalYear !== undefined) body.festivalYear = festivalYear
  const result = await request('/functions/v1/chat', { method: 'POST', body: JSON.stringify(body) }, publishableKey!)
  assert(result !== null && typeof result === 'object' && !Array.isArray(result), 'Chat response must be an object')
  return result as Json
}

function rows(response: Json, key: string): Json[] {
  const value = response[key]
  assert(Array.isArray(value), `Chat response ${key} must be an array`)
  return value as Json[]
}

function idsAndYears(items: Json[], source: boolean): Array<{ id: unknown; year: unknown }> {
  return items.map((item) => ({ id: item[source ? 'source_id' : 'id'] ?? item.id, year: item[source ? 'source_festival_year' : 'festival_year'] }))
}

async function runTest(name: string, query: string, expectedYear: 2025 | 2026, options: { fixtureExpected: boolean }): Promise<void> {
  const rpcRows = await directRpc(query, expectedYear)
  const response = await callChat(query)
  const sources = rows(response, 'retrievedSources')
  const events = rows(response, 'retrievedEvents')
  const chunks = rows(response, 'retrievedChunks')
  const citations = extractCitations(response)
  const answer = String((response.message as Json | undefined)?.content ?? '')
  assert(response.yearResolved === expectedYear, `${name}: expected yearResolved ${expectedYear}, received ${String(response.yearResolved)}`)
  assertAcceptanceAnswer(answer, expectedYear, options.fixtureExpected ? 'fixture' : 'unavailable')
  assertOnlyYear(sources, expectedYear, `${name} retrievedSources`)
  assertOnlyYear(events, expectedYear, `${name} retrievedEvents`)
  assertOnlyYear(chunks, expectedYear, `${name} retrievedChunks`)
  assertOnlyYear(citations, expectedYear, `${name} citations`)
  const fixture = FIXTURES.find((value) => value.year === expectedYear)!
  const hasFixtureChunk = chunks.some((chunk) => chunk.source_id === fixture.sourceId)
  const rpcHasFixture = rpcRows.some((chunk) => chunk.source_id === fixture.sourceId)
  if (options.fixtureExpected) {
    assert(hasFixtureChunk, `${name}: deployed chat did not retrieve the expected fixture chunk`)
    assert(rpcHasFixture, `${name}: direct semantic RPC did not retrieve the expected fixture chunk above threshold`)
    assert(events.some((event) => event.id === fixture.eventId), `${name}: expected fixture event was not retrieved`)
  } else {
    assert(!hasFixtureChunk && !rpcHasFixture, `${name}: inactive 2026 fixture was retrieved`)
    assert(!events.some((event) => event.id === fixture.eventId), `${name}: inactive 2026 event was retrieved`)
  }
  const topSimilarity = [...chunks, ...rpcRows].reduce((top, chunk) => Math.max(top, Number(chunk.similarity) || 0), 0)
  console.log(JSON.stringify({
    test: name, answer, resolvedYear: response.yearResolved,
    sources: idsAndYears(sources, false), events: idsAndYears(events, false), chunks: idsAndYears(chunks, true),
    semanticQueryEmbedding: options.fixtureExpected
      ? 'verified: fixture chunk returned by deployed retrieval and direct RETRIEVAL_QUERY RPC'
      : 'verified: normalized RETRIEVAL_QUERY sent to direct RPC; inactive fixture correctly absent',
    topSimilarity, citations: citations.map((citation) => ({ id: citation.id, year: citation.festivalYear })),
  }, null, 2))
}

async function set2026Active(active: boolean): Promise<void> {
  const fixture = FIXTURES[1]
  await request(`/rest/v1/sources?id=eq.${fixture.sourceId}`, { method: 'PATCH', body: JSON.stringify({ status: active ? 'active' : 'archived' }) })
  await request(`/rest/v1/events?id=eq.${fixture.eventId}`, { method: 'PATCH', body: JSON.stringify({ status: active ? 'confirmed' : 'postponed' }) })
}

async function runAcceptance(): Promise<void> {
  await seed()
  await runTest('A current question', 'When and where is the current Buglasan Chess Tournament?', 2026, { fixtureExpected: true })
  await runTest('B explicit 2025', 'When and where is the Buglasan Chess Tournament 2025?', 2025, { fixtureExpected: true })
  try {
    await set2026Active(false)
    await runTest('C current question with 2026 unavailable', 'When and where is the current Buglasan Chess Tournament?', 2026, { fixtureExpected: false })
  } finally {
    await set2026Active(true)
  }
  console.log(`A/B/C passed in project ${projectRef}. Fixtures remain active; use --cleanup explicitly to remove them.`)
}

await (cleanupOnly ? cleanup() : runAcceptance())
