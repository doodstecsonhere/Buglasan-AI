/**
 * Operator-only Gate B proof. This deliberately calls imported, manually activated
 * n8n webhooks; it never imports workflows, deploys services, or starts Docker.
 */
import { readFileSync } from 'node:fs'

const optIn = 'I_UNDERSTAND_THIS_WRITES_SYNTHETIC_GATE_B_FIXTURES'
const fixturePath = 'test/fixtures/gate-b-n8n-acceptance.json'
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  source: Record<string, unknown>
  textlessSource: Record<string, unknown>
}
const supabaseUrl = process.env.SUPABASE_URL
const serviceKey = (JSON.parse(process.env.SUPABASE_SECRET_KEYS ?? '{}') as Record<string, string>).default ?? process.env.SUPABASE_SECRET_KEY
const expectedRef = process.env.SUPABASE_EXPECTED_PROJECT_REF
const n8nUrl = process.env.GATE_B_N8N_URL?.replace(/\/$/, '')
const sourceToken = process.env.GATE_B_SOURCE_WEBHOOK_TOKEN
const workerToken = process.env.GATE_B_WORKER_WEBHOOK_TOKEN
const cleanupToken = process.env.PIPELINE_ACCEPTANCE_FIXTURE_TOKEN

function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(`Gate B acceptance assertion failed: ${label}`) }
function isLoopbackHttpUrl(value: string): boolean {
  const url = new URL(value)
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}
function guard(): void {
  assert(process.env.LIVE_GATE_B_N8N_ACCEPTANCE === optIn, 'exact LIVE_GATE_B_N8N_ACCEPTANCE opt-in')
  assert(supabaseUrl && serviceKey && expectedRef && n8nUrl && sourceToken && workerToken && cleanupToken, 'all documented operator environment names are configured')
  assert(new URL(supabaseUrl).hostname.split('.')[0] === expectedRef, 'SUPABASE_EXPECTED_PROJECT_REF matches SUPABASE_URL')
  assert(new URL(n8nUrl).protocol === 'https:' || isLoopbackHttpUrl(n8nUrl), 'GATE_B_N8N_URL uses HTTPS or loopback HTTP')
  assert(sourceToken !== workerToken && sourceToken !== cleanupToken && workerToken !== cleanupToken, 'webhook and cleanup tokens are distinct')
}
async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { /* assertion below reports non-JSON safely */ }
  assert(body && typeof body === 'object' && !Array.isArray(body), `JSON response (${response.status})`)
  return body as Record<string, unknown>
}
async function webhook(path: string, token: string, headerName: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${n8nUrl}/webhook/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', [headerName]: token }, body: JSON.stringify(payload) })
  const body = await responseBody(response)
  assert(response.ok, `${path} webhook returns HTTP success`)
  return body
}
async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${supabaseUrl}${path}`, { ...init, headers: { apikey: serviceKey!, 'content-type': 'application/json', ...(init.headers ?? {}) } })
}
async function rows(table: string, filter: string, select: string): Promise<Array<Record<string, unknown>>> {
  const response = await api(`/rest/v1/${table}?${filter}&select=${select}`)
  assert(response.ok, `${table} audit is readable`)
  const result = await response.json()
  assert(Array.isArray(result), `${table} audit result is an array`)
  return result as Array<Record<string, unknown>>
}
async function cleanup(): Promise<void> {
  guard()
  const response = await fetch(`${supabaseUrl}/functions/v1/cleanup-pipeline-acceptance`, { method: 'POST', headers: { apikey: serviceKey!, 'content-type': 'application/json', 'x-pipeline-acceptance-fixture-token': cleanupToken! } })
  assert(response.ok, `trusted cleanup returns HTTP success (${response.status})`)
  const leftovers = await rows('sources', 'post_id=like.pipeline-test-*', 'id,post_id')
  assert(leftovers.length === 0, 'trusted cleanup leaves zero pipeline-test sources')
}
async function sourceId(postId: string): Promise<string> {
  const found = await rows('sources', `post_id=eq.${encodeURIComponent(postId)}`, 'id,content_fingerprint,festival_year')
  assert(found.length === 1 && typeof found[0].id === 'string', `${postId} resolves to one source`)
  return found[0].id as string
}
async function waitFor(table: string, filter: string, accepted: readonly string[], label: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const select = table === 'events'
      ? 'status,extracted_source_id,id,is_current,festival_year'
      : table === 'source_indexings'
        ? 'status,source_id,id'
        : 'status,candidate_source_id,candidate_event_id,id'
    const found = await rows(table, filter, select)
    const row = found.find((value) => typeof value.status === 'string' && accepted.includes(value.status))
    if (row) return row
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  throw new Error(`Gate B acceptance assertion failed: ${label}`)
}
async function acceptance(): Promise<void> {
  guard()
  await cleanup()
  try {
    const first = await webhook('buglasan-source-collector', sourceToken!, 'x-gate-b-acceptance-token', fixture.source)
    assert(first.accepted === true && typeof first.source_id === 'string', 'Workflow A authenticated canonical source acceptance')
    const replay = await webhook('buglasan-source-collector', sourceToken!, 'x-gate-b-acceptance-token', fixture.source)
    assert(replay.accepted === true && replay.source_id === first.source_id, 'Workflow A idempotent replay identity')
    const edited = { ...fixture.source, title: 'pipeline-test-10-canonical updated synthetic title' }
    const update = await webhook('buglasan-source-collector', sourceToken!, 'x-gate-b-acceptance-token', edited)
    assert(update.accepted === true && update.source_id === first.source_id, 'Workflow A update retains source identity')

    const canonicalSourceId = await sourceId(String(fixture.source.post_id))
    const extraction = await webhook('buglasan-knowledge-extractor', workerToken!, 'x-internal-orchestration-token', { source_id: canonicalSourceId })
    assert(extraction.status === 'extracted', 'Workflow B synthetic terminal extraction')
    const candidate = await waitFor('events', `extracted_source_id=eq.${canonicalSourceId}&is_current=eq.true`, ['confirmed', 'scheduled'], 'Workflow B persisted current candidate evidence')
    assert(candidate.festival_year === 2027, 'Workflow B explicit event year evidence')
    const extractionReplay = await webhook('buglasan-knowledge-extractor', workerToken!, 'x-internal-orchestration-token', { source_id: canonicalSourceId })
    assert(['extracted', 'processing'].includes(String(extractionReplay.status)), 'Workflow B replay is terminal or lease-safe')

    const indexing = await webhook('buglasan-semantic-index', workerToken!, 'x-internal-orchestration-token', { source_id: canonicalSourceId })
    assert(['indexed', 'processing'].includes(String(indexing.status)), `Workflow C text indexing terminal or lease-safe (status=${String(indexing.status)})`)
    await waitFor('source_indexings', `source_id=eq.${canonicalSourceId}`, ['indexed'], 'Workflow C persisted indexing evidence')
    const indexingReplay = await webhook('buglasan-semantic-index', workerToken!, 'x-internal-orchestration-token', { source_id: canonicalSourceId })
    assert(['indexed', 'processing'].includes(String(indexingReplay.status)), 'Workflow C replay is terminal or lease-safe')

    const textless = await webhook('buglasan-source-collector', sourceToken!, 'x-gate-b-acceptance-token', fixture.textlessSource)
    assert(textless.accepted === true, 'Workflow A accepts null-text provenance boundary')
    const textlessSourceId = await sourceId(String(fixture.textlessSource.post_id))
    const nullIndex = await webhook('buglasan-semantic-index', workerToken!, 'x-internal-orchestration-token', { source_id: textlessSourceId })
    assert(['needs_review', 'processing'].includes(String(nullIndex.status)), 'Workflow C image-only/null-text review evidence')
    await waitFor('source_indexings', `source_id=eq.${textlessSourceId}`, ['needs_review'], 'Workflow C persisted null-text review evidence')

    assert(typeof candidate.id === 'string', 'candidate ID available for explicit Workflow D orchestration')
    const reconciliation = await webhook('buglasan-event-reconcile', workerToken!, 'x-internal-orchestration-token', { candidate_event_id: candidate.id as string })
    assert(['reconciled', 'needs_review', 'processing'].includes(String(reconciliation.status)), 'Workflow D explicit reconciliation orchestration')
    await waitFor('event_reconciliation_runs', `candidate_event_id=eq.${candidate.id}`, ['reconciled', 'needs_review'], 'Workflow D persisted reconciliation evidence')
    console.log('Gate B n8n acceptance passed: A auth/idempotence/update, B terminal/replay, C text/null/replay, D explicit reconciliation, and persisted evidence.')
  } finally {
    await cleanup()
    console.log('Gate B trusted cleanup verified zero pipeline-test fixture sources.')
  }
}

if (process.argv[2] === '--acceptance') await acceptance()
else if (process.argv[2] === '--cleanup') await cleanup()
else throw new Error('Use --acceptance or --cleanup')
