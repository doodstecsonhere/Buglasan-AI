import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { RECONCILER_VERSION, compareCandidate, gateComparisons, hasCreationEvidence, isRetryableGeminiStatus, parseGeminiClassification, rankShortlist, type Candidate, type CanonicalTarget } from '../_shared/reconciliation.ts'

const URL = Deno.env.get('SUPABASE_URL') ?? ''
const KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? ''
const TOKEN = Deno.env.get('RECONCILE_EVENT_TOKEN') ?? ''
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? ''
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const equal = (a: string, b: string) => { const x = new TextEncoder().encode(a); const y = new TextEncoder().encode(b); let d = x.length ^ y.length; for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0); return d === 0 }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
async function db(path: string, init: RequestInit = {}) { const r = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, 'content-type': 'application/json', ...(init.headers ?? {}) } }); const text = await r.text(); if (!r.ok) throw new Error(`database_${r.status}`); return text ? JSON.parse(text) : null }
async function sha256(value: unknown) { const bytes = new TextEncoder().encode(JSON.stringify(value)); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('') }

function evidenceFor(candidate: Candidate, snapshot: Record<string, unknown>) {
  const evidence = candidate.extraction_evidence as Array<Record<string, unknown>>
  return Object.entries(snapshot).flatMap(([field_name, value_json]) => {
    if (value_json === null || value_json === undefined || field_name === 'aliases') return []
    const evidence_index = evidence.findIndex((item) => item?.field === field_name && (typeof item.excerpt === 'string' || typeof item.locator === 'string'))
    return evidence_index < 0 ? [] : [{ field_name, value_json, evidence_index, selection_reason: 'candidate_validated_evidence' }]
  })
}
async function classifyAmbiguity(comparisons: ReturnType<typeof rankShortlist>): Promise<Record<string, unknown> | null> {
  if (!GEMINI_KEY || !GEMINI_MODEL) return null
  const options = comparisons.slice(0, 12).map(({ target_id, ...features }) => ({ target_id, features }))
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Classify only this bounded reconciliation ambiguity. Return JSON only: {"decision":"needs_review"|"choose_target_id"|"create","target_id":string|null,"rationale":"<=240 chars"}. Do not infer facts. Options: ${JSON.stringify(options)}` }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }) })
  if (!r.ok) { if (isRetryableGeminiStatus(r.status)) throw new Error('gemini_retryable'); return null }
  try { const payload = await r.json(); const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text; const parsed = typeof text === 'string' ? JSON.parse(text) : null; return parseGeminiClassification(parsed, options.map((item) => item.target_id)) } catch { return null }
}

serve(async (request: Request) => {
  if (request.method !== 'POST') return json(405, { status: 'permanent_error', error: 'method_not_allowed' })
  if (!TOKEN || !equal(request.headers.get('x-reconcile-event-token') ?? '', TOKEN)) return json(401, { status: 'permanent_error', error: 'unauthorized' })
  if (!URL || !KEY) return json(500, { status: 'permanent_error', error: 'server_not_configured' })
  let body: Record<string, unknown>; try { body = await request.json() } catch { return json(400, { status: 'permanent_error', error: 'invalid_json' }) }
  if (Object.keys(body).length !== 1 || !uuid(body.candidate_event_id)) return json(400, { status: 'permanent_error', error: 'invalid_request' })
  const candidateId = body.candidate_event_id
  const claimToken = crypto.randomUUID()
  let claim: Record<string, unknown> | null = null
  try {
    claim = await db('rpc/claim_event_reconciliation', { method: 'POST', body: JSON.stringify({ p_candidate_event_id: candidateId, p_reconciler_version: RECONCILER_VERSION, p_claim_token: claimToken, p_lease_seconds: 120 }) }) as Record<string, unknown>
    if (claim.status !== 'processing' || claim.claim_token !== claimToken) return json(200, { status: claim.status, candidate_event_id: candidateId, canonical_event_id: claim.canonical_event_id ?? null, cached: claim.status !== 'processing', in_progress: claim.status === 'processing' })
    const candidates = await db(`events?id=eq.${candidateId}&select=*&limit=1`) as Candidate[]; const candidate = candidates[0]
    if (!candidate || !candidate.festival_year || !Array.isArray(candidate.extraction_evidence)) throw new Error('candidate_ineligible')
    const events = await db(`canonical_events?festival_year=eq.${candidate.festival_year}&lifecycle_status=in.(scheduled,confirmed,postponed)&select=id,festival_year,lifecycle_status,current_version_id`) as Array<Record<string, unknown>>
    const versionIds = events.map((event) => event.current_version_id).filter(uuid)
    const versions = versionIds.length ? await db(`canonical_event_versions?id=in.(${versionIds.join(',')})&select=*`) as Array<Record<string, unknown>> : []
    const versionsById = new Map(versions.map((version) => [String(version.id), version]))
    const targets: CanonicalTarget[] = events.flatMap((event) => {
      const current_version = versionsById.get(String(event.current_version_id))
      return current_version ? [{ id: String(event.id), festival_year: Number(event.festival_year), lifecycle_status: String(event.lifecycle_status), current_version } as CanonicalTarget] : []
    })
    const ranked = rankShortlist(targets.map((target) => compareCandidate(candidate, target)))
    const gate = gateComparisons(ranked); const shortlist = ranked.slice(0, 13); const base = { shortlist, gate }
    let outcome: Record<string, unknown>
    if (gate.passes) {
      const target = targets.find((item) => item.id === gate.target_id)!; const snapshot = { ...target.current_version, status: target.lifecycle_status }
      const fields = evidenceFor(candidate, snapshot)
      outcome = fields.length ? { action: 'unchanged', reason: 'deterministic_identical_snapshot', canonical_event_id: target.id, ...base, field_evidence: fields } : { action: 'needs_review', reason: 'invalid_evidence', ...base }
    } else if (!ranked.length && hasCreationEvidence(candidate)) {
      const snapshot = { event_name: candidate.event_name, aliases: candidate.aliases ?? [], description: candidate.description ?? null, category: candidate.category ?? null, start_datetime: candidate.start_datetime ?? null, end_datetime: candidate.end_datetime ?? null, venue: candidate.venue ?? null, organizer: candidate.organizer ?? null, deadline: candidate.deadline ?? null, eligibility: candidate.eligibility ?? null, fees: candidate.fees ?? null, contact_info: candidate.contact_info ?? null, status: candidate.status === 'confirmed' ? 'confirmed' : 'scheduled' }
      const fields = evidenceFor(candidate, snapshot); outcome = fields.length >= 2 ? { action: 'create', reason: 'minimum_creation_evidence', ...base, gate: { ...gate, passes: true }, snapshot, change_kind: 'initial', field_evidence: fields } : { action: 'needs_review', reason: 'invalid_evidence', ...base }
    } else {
      const gemini = ranked.length > 1 ? await classifyAmbiguity(ranked) : null
      outcome = { action: 'needs_review', reason: gemini ? 'gemini_ambiguity' : ranked.length ? 'gate_failed' : 'insufficient_create_evidence', ...base, gemini }
    }
    const inputHash = await sha256({ candidate_id: candidate.id, extraction_identity: candidate.extraction_identity, shortlist, gate })
    const persisted = await db('rpc/resolve_event_reconciliation', { method: 'POST', body: JSON.stringify({ p_run_id: claim.id, p_claim_token: claimToken, p_candidate_event_id: candidateId, p_reconciler_version: RECONCILER_VERSION, p_input_hash: inputHash, p_outcome: outcome }) }) as Record<string, unknown>
    return json(200, { status: persisted.status, candidate_event_id: candidateId, canonical_event_id: persisted.canonical_event_id ?? null, cached: persisted.cached ?? false })
  } catch (error) {
    const retryable = error instanceof Error && error.message === 'gemini_retryable'; const code = retryable ? 'provider_unavailable' : 'reconciliation_failed'
    if (claim?.id) await db('rpc/fail_event_reconciliation', { method: 'POST', body: JSON.stringify({ p_run_id: claim.id, p_claim_token: claimToken, p_status: retryable ? 'retryable_error' : 'permanent_error', p_error_code: code, p_error_message: retryable ? 'Gemini provider unavailable' : 'reconciliation validation or database failure' }) }).catch(() => null)
    return json(retryable ? 503 : 422, { status: retryable ? 'retryable_error' : 'permanent_error', candidate_event_id: candidateId, error: code })
  }
})
