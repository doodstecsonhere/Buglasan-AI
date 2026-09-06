import { createHash } from 'node:crypto'

const prefix = 'reconciliation-test-'
const mode = process.argv[2]
const url = process.env.SUPABASE_URL
const expectedRef = process.env.SUPABASE_EXPECTED_PROJECT_REF
const optIn = process.env.LIVE_EVENT_RECONCILIATION_TEST
const token = process.env.RECONCILE_EVENT_TOKEN
const fixtureToken = process.env.RECONCILIATION_ACCEPTANCE_FIXTURE_TOKEN
const secretKey = (JSON.parse(process.env.SUPABASE_SECRET_KEYS ?? '{}') as Record<string, string>).default ?? process.env.SUPABASE_SECRET_KEY

function guard(): void {
  if (optIn !== 'I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION') throw new Error('Live event reconciliation opt-in is not set')
  if (!url || !expectedRef || !secretKey || !token || !fixtureToken) throw new Error('Required server-side environment variable names are not configured')
  if (token === fixtureToken) throw new Error('Acceptance fixture token must differ from the reconciliation token')
  if (new URL(url).hostname.split('.')[0] !== expectedRef) throw new Error('SUPABASE_EXPECTED_PROJECT_REF does not match SUPABASE_URL')
}
async function api(path: string, init: RequestInit = {}): Promise<Response> { return fetch(`${url}${path}`, { ...init, headers: { apikey: secretKey!, 'content-type': 'application/json', ...(init.headers ?? {}) } }) }
async function scopedSources(): Promise<Array<{ id: string; post_id: string }>> {
  const response = await api(`/rest/v1/sources?post_id=like.${prefix}*&select=id,post_id`)
  if (!response.ok) throw new Error(`Scoped source lookup failed: ${response.status}`)
  const rows = await response.json() as Array<{ id: string; post_id: string }>
  if (rows.some((row) => !row.post_id.startsWith(prefix))) throw new Error('Fixture scope invariant failed')
  return rows
}
async function cleanup(): Promise<void> {
  guard()
  const sources = await scopedSources(); const ids = sources.map((row) => row.id)
  if (ids.length) {
    const sourceFilter = ids.join(',')
    const events = await api(`/rest/v1/events?extracted_source_id=in.(${sourceFilter})&select=id`)
    if (!events.ok) throw new Error(`Scoped candidate lookup failed: ${events.status}`)
    const eventIds = (await events.json() as Array<{ id: string }>).map((row) => row.id)
    // Phase 8 history is intentionally append-only. Refuse to delete a fixture
    // once it has entered reconciliation rather than widening cleanup scope.
    if (eventIds.length) throw new Error('Refusing cleanup: exact fixture has candidate rows; retain append-only reconciliation history')
    const response = await api(`/rest/v1/sources?id=in.(${sourceFilter})`, { method: 'DELETE', headers: { prefer: 'return=minimal' } }); if (!response.ok) throw new Error(`Scoped cleanup failed: ${response.status}`)
  }
  if ((await scopedSources()).length) throw new Error('Cleanup verification failed')
  console.log(`Reconciliation cleanup removed only exact ${prefix} fixtures.`)
}
async function acceptance(): Promise<void> {
  guard(); await cleanup()
  const text = 'Reconciliation test event at Freedom Park on October 18, 2026.'
  const fingerprint = createHash('sha256').update(text).digest('hex')
  const ingested = await api('/rest/v1/rpc/ingest_source', { method: 'POST', body: JSON.stringify({ p_payload: { platform: 'facebook', post_id: `${prefix}gemini-blocked`, post_url: 'https://example.invalid/reconciliation-test', published_at: '2026-09-05T08:00:00+08:00', post_year: 2026, festival_year: 2026, raw_text: text, normalized_text: text, title: `${prefix}gemini-blocked`, source_type: 'text', media_urls: [], collected_at: new Date().toISOString(), collection_method: 'manual', source_metadata: { acceptance: true, fingerprint } } }) })
  if (!ingested.ok) throw new Error(`Fixture ingestion failed: ${ingested.status}`)
  console.log('Fixture ingestion completed. This harness does not invoke Gemini directly; provider availability is reported only by reconcile-event as retryable_error/provider_unavailable. Run cleanup separately.')
}
if (mode === '--acceptance') await acceptance(); else if (mode === '--cleanup') await cleanup(); else throw new Error('Use --acceptance or --cleanup')
