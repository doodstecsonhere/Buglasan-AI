/**
 * Phase 10 single-source replay. The target and manifest are intentionally
 * constants: this is not a general-purpose mutation or SQL interface.
 *
 * The runner deliberately speaks only to the existing RPCs and function
 * endpoints. It has no SQL mutation path and the transport is injectable for
 * deterministic tests.
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { parseManifestText, validateManifest } from './phase10-manifest-intake.ts'
import type { SourceIngestionPayload } from '../src/ingestion/sourceIngestion.ts'

export const PHASE10_SOURCE_REPLAY = Object.freeze({
  postId: '1472636598234727',
  sourceUuid: '254d56af-7bf4-4913-8a9b-d5ab34367b33',
  manifestPath: 'operator-manifests/buglasan-2026-real-corpus-01.json',
  extractorVersion: 'phase6-v1',
  indexerVersion: 'semantic-index-v1',
  embeddingModel: 'gemini-embedding-001',
  embeddingDimensions: 768,
  reconcilerVersion: 'reconciler-v1',
})

export type DurableState = {
  source: Record<string, unknown> | null
  extraction: Record<string, unknown> | null
  indexing: Record<string, unknown> | null
  reconciliation: Record<string, unknown>[]
}
export type ReplayOutcome = 'completed' | 'outcome_indeterminate' | 'blocked' | 'failed_closed'
export type ReplayPlan = {
  post_id: string
  source_id: string
  fingerprint: string
  source_action: 'blocked' | 'unchanged' | 'update'
  extraction_action: 'skip' | 'resume' | 'claim'
  indexing_action: 'skip' | 'resume' | 'claim'
  reconciliation_action: 'skip' | 'needs_review' | 'blocked'
  writes: number
  execution_blocked?: string
}

export type ReplayAdapter = {
  provenForPhase10: true
  reconciliationContract: 'candidate-event-v1'
  inspect: (sourceId: string, postId: string) => Promise<DurableState>
  preflight: (input: { sourceId: string; postId: string; expected: SourceIngestionPayload; before: DurableState }) => Promise<void>
  replay: (input: { expected: SourceIngestionPayload; before: DurableState; plan: ReplayPlan }) => Promise<unknown>
}

export type Phase10Transport = (url: string, init: RequestInit) => Promise<Response>

export type Phase10HttpConfig = {
  supabaseUrl: string
  serviceKey: string
  operatorToken: string
  extractionToken: string
  indexingToken: string
  reconciliationToken: string
  transport?: Phase10Transport
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

const REDACT_KEY = /key|token|secret|password|credential|authorization|cookie/i
export function redactReplay(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactReplay)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, REDACT_KEY.test(k) ? '[redacted]' : redactReplay(v)]))
  if (typeof value === 'string' && /(bearer|apikey|secret|token|password|credential)/i.test(value)) return '[redacted]'
  return value
}

function statusOf(row: Record<string, unknown> | null): string | null { return row && typeof row.status === 'string' ? row.status : null }
function oneCurrent(rows: unknown[], label: string): Record<string, unknown> | null {
  if (!Array.isArray(rows)) throw new Error(`${label} durable state must be an array`)
  if (rows.length > 1) throw new Error(`${label} state is ambiguous; replay is fail-closed`)
  return (rows[0] as Record<string, unknown> | undefined) ?? null
}

export function buildReplayPlan(expected: SourceIngestionPayload, before: DurableState): ReplayPlan {
  const source = before.source
  const observedFingerprint = source?.content_fingerprint
  if (source && (typeof observedFingerprint !== 'string' || !SHA256.test(observedFingerprint))) throw new Error('failed_closed: observed before-image fingerprint is invalid')
  if (!source) return {
    post_id: expected.post_id, source_id: PHASE10_SOURCE_REPLAY.sourceUuid, fingerprint: '',
    source_action: 'blocked', extraction_action: 'skip', indexing_action: 'skip',
    reconciliation_action: 'blocked', writes: 0,
    execution_blocked: 'preflight_blocked: canonical historical source is missing; no insert is permitted because ingest_source cannot preserve the hard-bound UUID',
  }
  if (source && String(source.id) !== PHASE10_SOURCE_REPLAY.sourceUuid) throw new Error('source UUID does not match the hard-bound replay target')
  if (source && String(source.post_id) !== expected.post_id) throw new Error('durable source post identity mismatch')
  const extractionStatus = statusOf(before.extraction)
  const indexingStatus = statusOf(before.indexing)
  const extractionDone = ['completed', 'needs_review', 'permanent_error'].includes(extractionStatus ?? '')
  const indexingDone = ['indexed', 'no_text', 'needs_review', 'permanent_error'].includes(indexingStatus ?? '')
  const reconciliation = before.reconciliation
  if (!Array.isArray(reconciliation)) throw new Error('reconciliation durable state must be an array')
  const ambiguous = reconciliation.length > 1 || reconciliation.some((r) => ['processing', 'reconciled', 'needs_review'].includes(statusOf(r) ?? ''))
  return {
    post_id: expected.post_id, source_id: PHASE10_SOURCE_REPLAY.sourceUuid, fingerprint: observedFingerprint as string,
    source_action: 'update',
    extraction_action: extractionDone ? 'skip' : extractionStatus === 'processing' ? 'resume' : 'claim',
    indexing_action: indexingDone ? 'skip' : indexingStatus === 'processing' ? 'resume' : 'claim',
    reconciliation_action: ambiguous ? 'blocked' : 'needs_review',
    writes: 1,
    execution_blocked: ambiguous ? 'reconciliation state is ambiguous or already active; human review required' : undefined,
  }
}

function requiredConfig(config: Phase10HttpConfig): void {
  if (!config.supabaseUrl || !/^https:\/\//i.test(config.supabaseUrl) || !config.serviceKey || !config.operatorToken || !config.extractionToken || !config.indexingToken || !config.reconciliationToken) {
    throw new Error('failed_closed: incomplete Phase 10 HTTP configuration')
  }
  if (!UUID.test(PHASE10_SOURCE_REPLAY.sourceUuid)) throw new Error('failed_closed: invalid hard-bound source UUID')
}

async function jsonRequest(transport: Phase10Transport, url: string, init: RequestInit): Promise<unknown> {
  let response: Response
  try { response = await transport(url, init) } catch { throw new Error('outcome_indeterminate: transport failure') }
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!response.ok) throw new Error(`stage_failed:${response.status}:${typeof body === 'object' && body ? JSON.stringify(redactReplay(body)) : 'unparseable response'}`)
  return body
}

export function createPhase10HttpAdapter(config: Phase10HttpConfig): ReplayAdapter {
  requiredConfig(config)
  const transport = config.transport ?? fetch
  const base = config.supabaseUrl.replace(/\/$/, '')
  const rest = (path: string, body: unknown) => jsonRequest(transport, `${base}/rest/v1/${path}`, {
    method: 'POST', headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const get = (path: string) => jsonRequest(transport, `${base}/rest/v1/${path}`, { method: 'GET', headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` } })
  return {
    provenForPhase10: true,
    reconciliationContract: 'candidate-event-v1',
    async inspect(sourceId, postId) {
      const sources = await get(`sources?id=eq.${encodeURIComponent(sourceId)}&platform=eq.facebook&post_id=eq.${encodeURIComponent(postId)}&select=*`)
      const sourceRows = Array.isArray(sources) ? sources : []
      if (sourceRows.length > 1) throw new Error('failed_closed: duplicate canonical source identity')
      const source = (sourceRows[0] as Record<string, unknown> | undefined) ?? null
      const fingerprint = source?.content_fingerprint
      const extraction = fingerprint ? await get(`source_extractions?source_id=eq.${encodeURIComponent(sourceId)}&source_fingerprint=eq.${encodeURIComponent(String(fingerprint))}&extractor_version=eq.${encodeURIComponent(PHASE10_SOURCE_REPLAY.extractorVersion)}&select=*&order=created_at.desc&limit=2`) : []
      const indexing = fingerprint ? await get(`source_indexings?source_id=eq.${encodeURIComponent(sourceId)}&source_fingerprint=eq.${encodeURIComponent(String(fingerprint))}&indexer_version=eq.${encodeURIComponent(PHASE10_SOURCE_REPLAY.indexerVersion)}&embedding_model=eq.${encodeURIComponent(PHASE10_SOURCE_REPLAY.embeddingModel)}&select=*&order=created_at.desc&limit=2`) : []
      const reconciliation = source ? await get(`event_reconciliation_runs?candidate_source_id=eq.${encodeURIComponent(sourceId)}&candidate_source_fingerprint=eq.${encodeURIComponent(String(fingerprint))}&select=*&order=created_at.desc&limit=2`) : []
      return { source, extraction: oneCurrent(extraction as unknown[], 'extraction'), indexing: oneCurrent(indexing as unknown[], 'indexing'), reconciliation: (Array.isArray(reconciliation) ? reconciliation : []) as Record<string, unknown>[] }
    },
    async preflight({ sourceId, postId, expected, before }) {
      const current = await this.inspect(sourceId, postId)
      if (JSON.stringify(redactReplay(current)) !== JSON.stringify(redactReplay(before))) throw new Error('failed_closed: before-image changed during preflight')
      if (!current.source) throw new Error('preflight_blocked: canonical historical source is missing; no insert is permitted because ingest_source cannot preserve the hard-bound UUID')
      if (current.source.id !== sourceId) throw new Error('failed_closed: canonical UUID mismatch')
      if (current.source && (current.source.platform !== expected.platform || current.source.post_id !== expected.post_id)) throw new Error('failed_closed: canonical identity mismatch')
    },
    async replay({ expected, before, plan }) {
      const existingCandidates = await get(`events?extracted_source_id=eq.${encodeURIComponent(PHASE10_SOURCE_REPLAY.sourceUuid)}&source_fingerprint=eq.${encodeURIComponent(plan.fingerprint)}&extractor_version=eq.${encodeURIComponent(PHASE10_SOURCE_REPLAY.extractorVersion)}&is_current=eq.true&select=id`)
      const existingLinks = await get(`event_sources?source_id=eq.${encodeURIComponent(PHASE10_SOURCE_REPLAY.sourceUuid)}&select=event_id&limit=2`)
      if (Array.isArray(existingCandidates) && existingCandidates.length > 1) throw new Error('manual_reconciliation_required: multiple extraction candidates')
      if (Array.isArray(existingLinks) && existingLinks.length > 0) throw new Error('manual_reconciliation_required: existing event link state')
      const ingest = await rest('rpc/ingest_source', { p_payload: expected })
      const row = Array.isArray(ingest) ? ingest[0] as Record<string, unknown> : null
      if (!row || row.source_id !== PHASE10_SOURCE_REPLAY.sourceUuid || row.post_id !== expected.post_id) throw new Error('failed_closed: canonical ingestion UUID preservation failed')
      const newFingerprint = row.content_fingerprint
      if (typeof newFingerprint !== 'string' || !SHA256.test(newFingerprint)) throw new Error('failed_closed: canonical ingestion did not return a valid fingerprint')
      if (newFingerprint === plan.fingerprint) throw new Error('failed_closed: canonical ingestion fingerprint did not change')
      const afterIngest = await this.inspect(PHASE10_SOURCE_REPLAY.sourceUuid, expected.post_id)
      if (afterIngest.source?.content_fingerprint !== newFingerprint) throw new Error('failed_closed: canonical fingerprint was not persisted')
      const provenance = expected.source_metadata.provenance
      if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) throw new Error('failed_closed: manifest provenance is missing')
      const common = { source_id: PHASE10_SOURCE_REPLAY.sourceUuid, source_fingerprint: newFingerprint, extractor_version: PHASE10_SOURCE_REPLAY.extractorVersion, source_before: before.source, extraction_before: before.extraction, operator_metadata: provenance }
      let extraction: unknown = null
      if (plan.extraction_action !== 'skip') extraction = await jsonRequest(transport, `${base}/functions/v1/extract-source`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-extraction-token': config.extractionToken, 'x-phase10-operator-token': config.operatorToken }, body: JSON.stringify(common) })
      const refreshed = await this.inspect(PHASE10_SOURCE_REPLAY.sourceUuid, expected.post_id)
      const eligible = refreshed.extraction?.status === 'extracted' || refreshed.extraction?.status === 'no_event'
      let indexing: unknown = null
      if (eligible && plan.indexing_action !== 'skip') indexing = await jsonRequest(transport, `${base}/functions/v1/index-source`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-index-source-token': config.indexingToken }, body: JSON.stringify({ source_id: PHASE10_SOURCE_REPLAY.sourceUuid }) })
      const finalState = await this.inspect(PHASE10_SOURCE_REPLAY.sourceUuid, expected.post_id)
      const candidates = eligible ? await get(`events?extracted_source_id=eq.${encodeURIComponent(PHASE10_SOURCE_REPLAY.sourceUuid)}&source_fingerprint=eq.${encodeURIComponent(newFingerprint)}&extractor_version=eq.${encodeURIComponent(PHASE10_SOURCE_REPLAY.extractorVersion)}&is_current=eq.true&select=id`) : []
      const reconciliation: unknown[] = []
      if (Array.isArray(candidates) && candidates.length > 1) throw new Error('manual_reconciliation_required: multiple extraction candidates')
      if (Array.isArray(candidates) && candidates.length === 1) {
        const candidate = candidates[0]
        if (!candidate || typeof candidate !== 'object' || typeof (candidate as Record<string, unknown>).id !== 'string') throw new Error('failed_closed: reconciliation candidate identity is invalid')
        if (plan.reconciliation_action !== 'needs_review') throw new Error('manual_reconciliation_required: reconciliation state is not deterministic')
        reconciliation.push(await jsonRequest(transport, `${base}/functions/v1/reconcile-event`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-reconcile-event-token': config.reconciliationToken }, body: JSON.stringify({ candidate_event_id: (candidate as Record<string, unknown>).id }) }))
      }
      return { outcome: 'completed' satisfies ReplayOutcome, ingest: row, extraction, indexing, reconciliation, finalState }
    },
  }
}

export function loadBoundPayload(path = PHASE10_SOURCE_REPLAY.manifestPath): SourceIngestionPayload {
  if (path !== PHASE10_SOURCE_REPLAY.manifestPath) throw new Error('Phase 10 replay only accepts the trusted manifest')
  const parsed = parseManifestText(readFileSync(path, 'utf8'), 'json')
  const report = validateManifest(parsed)
  if (report.diagnostics.length) throw new Error(`trusted manifest validation failed: ${JSON.stringify(report.diagnostics)}`)
  const payload = report.payloads.find((item) => item.post_id === PHASE10_SOURCE_REPLAY.postId)
  if (!payload) throw new Error('hard-bound post_id is absent from the trusted manifest')
  return payload
}

export function parseReplayArguments(argv: string[]): { postId: string; execute: boolean } {
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  if (positional.length !== 1 || positional[0] !== PHASE10_SOURCE_REPLAY.postId) throw new Error(`usage: phase10:source-replay ${PHASE10_SOURCE_REPLAY.postId} [--execute]`)
  if (argv.filter((arg) => arg === '--execute').length > 1) throw new Error('--execute may be supplied at most once')
  if (argv.some((arg) => arg.startsWith('--') && arg !== '--execute')) throw new Error('unsupported replay flag')
  return { postId: positional[0], execute: argv.includes('--execute') }
}

export async function runSourceReplay(adapter: ReplayAdapter | undefined, execute = false): Promise<Record<string, unknown>> {
  const expected = loadBoundPayload()
  const before = adapter ? await adapter.inspect(PHASE10_SOURCE_REPLAY.sourceUuid, expected.post_id) : { source: null, extraction: null, indexing: null, reconciliation: [] }
  const plan = buildReplayPlan(expected, before)
  if (!execute) return redactReplay({ mode: 'dry-run', non_mutating: true, writes: 0, before, plan }) as Record<string, unknown>
  if (!adapter?.provenForPhase10 || adapter.reconciliationContract !== 'candidate-event-v1') throw new Error('failed_closed: no proven Phase 10 adapter contract')
  await adapter.preflight({ sourceId: PHASE10_SOURCE_REPLAY.sourceUuid, postId: expected.post_id, expected, before })
  if (plan.source_action === 'blocked' || plan.reconciliation_action === 'blocked') return redactReplay({ mode: 'execute', outcome: 'blocked', status: 'preflight_blocked', plan }) as Record<string, unknown>
  try { return redactReplay({ mode: 'execute', plan, result: await adapter.replay({ expected, before, plan }) }) as Record<string, unknown> }
  catch (error) {
    const message = error instanceof Error ? error.message : 'unknown failure'
    const outcome: ReplayOutcome = message.startsWith('outcome_indeterminate:') ? 'outcome_indeterminate' : 'failed_closed'
    return redactReplay({ mode: 'execute', outcome, plan, error: message }) as Record<string, unknown>
  }
}

export function replayExitCode(result: Record<string, unknown>): number {
  if (result.mode === 'dry-run') return 0
  const outcome = result.outcome ?? (result.result && typeof result.result === 'object' ? (result.result as Record<string, unknown>).outcome : undefined)
  return outcome === 'completed' || outcome === 'replay_complete' || outcome === 'safe' ? 0 : 1
}

if (import.meta.main) {
  const { execute } = parseReplayArguments(process.argv.slice(2))
  const adapter = execute ? createPhase10HttpAdapter({
    supabaseUrl: process.env.SUPABASE_URL ?? '', serviceKey: process.env.SUPABASE_SECRET_KEY ?? '',
    operatorToken: process.env.PHASE10_OPERATOR_TOKEN ?? '', extractionToken: process.env.EXTRACT_SOURCE_TOKEN ?? '',
    indexingToken: process.env.INDEX_SOURCE_TOKEN ?? '', reconciliationToken: process.env.RECONCILE_EVENT_TOKEN ?? '',
  }) : undefined
  try {
    const result = await runSourceReplay(adapter, execute)
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = replayExitCode(result)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
