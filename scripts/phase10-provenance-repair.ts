/** Guarded Phase 10 provenance repair for one audited source only.
 *
 * This module intentionally has no SQL, terminal-retry, reconciliation, or
 * event-link mutation path. All writes are delegated to the normal RPC and
 * function contracts through an injectable adapter.
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { parseManifestText, validateManifest } from './phase10-manifest-intake.ts'
import { loadEnvLocal } from './phase10-status.ts'
import type { SourceIngestionPayload } from '../src/ingestion/sourceIngestion.ts'

export const PHASE10_PROVENANCE_REPAIR = Object.freeze({
  sourceUuid: '254d56af-7bf4-4913-8a9b-d5ab34367b33',
  postId: '1472636598234727',
  beforeFingerprint: '02f61ce417f0ea742c75167b155fa682cf8bfa5f4bd21cb16b8f4774b0f63753',
  manifestPath: 'operator-manifests/buglasan-2026-real-corpus-01.json',
  extractionVersion: 'phase6-v1',
  indexerVersion: 'semantic-index-v1',
  embeddingModel: 'gemini-embedding-001',
  embeddingDimensions: 768,
})

const SHA256 = /^[0-9a-f]{64}$/i
type Row = Record<string, unknown>
export type RepairState = {
  source: Row | null
  extraction: Row | null
  indexing: Row | null
  historical: { events: Row[]; links: Row[]; reviews: Row[]; reconciliation: Row[] }
}
export type RepairAdapter = {
  inspect: (sourceId: string, postId: string) => Promise<RepairState>
  ingestSource: (payload: SourceIngestionPayload) => Promise<Row>
  extractSource: (input: { sourceId: string; fingerprint: string; provenance: Row }) => Promise<Row>
  indexSource: (input: { sourceId: string; fingerprint: string; indexerVersion: string; embeddingModel: string; embeddingDimensions: number }) => Promise<Row>
}
export type RepairOptions = { adapter?: RepairAdapter; execute?: boolean; manifestPath?: string; readManifest?: (path: string) => string }

const REDACT = /key|token|secret|password|credential|authorization|cookie/i
export function redactProvenanceRepair(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactProvenanceRepair)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, REDACT.test(k) ? '[redacted]' : redactProvenanceRepair(v)]))
  if (typeof value === 'string' && /(bearer|apikey|secret|token|password|credential)/i.test(value)) return '[redacted]'
  return value
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b) }
function assertBefore(adapter: RepairAdapter, before: RepairState, label: string): Promise<void> {
  return adapter.inspect(PHASE10_PROVENANCE_REPAIR.sourceUuid, PHASE10_PROVENANCE_REPAIR.postId).then(current => {
    if (!same(current, before)) throw new Error(`failed_closed: before-image mismatch before ${label}`)
  })
}
function assertTargetState(state: RepairState): void {
  if (!state.source || state.source.id !== PHASE10_PROVENANCE_REPAIR.sourceUuid || state.source.post_id !== PHASE10_PROVENANCE_REPAIR.postId) throw new Error('failed_closed: canonical source identity mismatch')
  if (state.source.content_fingerprint !== PHASE10_PROVENANCE_REPAIR.beforeFingerprint) throw new Error('failed_closed: exact BEFORE fingerprint mismatch')
  if (!Array.isArray(state.historical?.events) || !Array.isArray(state.historical.links) || !Array.isArray(state.historical.reviews) || !Array.isArray(state.historical.reconciliation)) throw new Error('failed_closed: historical state is not inspectable')
}
function assertHistorical(before: RepairState, after: RepairState): void {
  if (!same(before.historical, after.historical)) throw new Error('failed_closed: historical event/link/review/reconciliation state changed')
}

export function loadTrustedProvenancePayload(path = PHASE10_PROVENANCE_REPAIR.manifestPath, readManifest = (file: string) => readFileSync(file, 'utf8')): SourceIngestionPayload {
  if (path !== PHASE10_PROVENANCE_REPAIR.manifestPath) throw new Error('trusted manifest path is required')
  const report = validateManifest(parseManifestText(readManifest(path), 'json'))
  if (report.diagnostics.length) throw new Error(`trusted manifest validation failed: ${JSON.stringify(report.diagnostics)}`)
  const payload = report.payloads.find(item => item.post_id === PHASE10_PROVENANCE_REPAIR.postId)
  if (!payload) throw new Error('hard-bound post_id is absent from the trusted manifest')
  const provenance = payload.source_metadata.provenance
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) throw new Error('trusted manifest provenance is required')
  return payload
}

export function parseProvenanceRepairArguments(argv: string[]): { postId: string; execute: boolean } {
  const positional = argv.filter(a => !a.startsWith('--'))
  if (positional.length !== 1 || positional[0] !== PHASE10_PROVENANCE_REPAIR.postId) throw new Error(`usage: phase10:provenance-repair ${PHASE10_PROVENANCE_REPAIR.postId} [--execute]`)
  if (argv.some(a => a.startsWith('--') && a !== '--execute') || argv.filter(a => a === '--execute').length > 1) throw new Error('unsupported provenance repair flag')
  return { postId: positional[0], execute: argv.includes('--execute') }
}

export async function runProvenanceRepair(options: RepairOptions = {}): Promise<Record<string, unknown>> {
  const payload = loadTrustedProvenancePayload(options.manifestPath, options.readManifest)
  if (payload.post_id !== PHASE10_PROVENANCE_REPAIR.postId || payload.platform !== 'facebook') throw new Error('failed_closed: manifest identity mismatch')
  if (!options.execute) return { mode: 'dry-run', non_mutating: true, writes: 0, target: PHASE10_PROVENANCE_REPAIR }
  const adapter = options.adapter
  if (!adapter) throw new Error('failed_closed: --execute requires a proven normal-path adapter')
  const before = await adapter.inspect(PHASE10_PROVENANCE_REPAIR.sourceUuid, PHASE10_PROVENANCE_REPAIR.postId)
  assertTargetState(before)
  const provenance = payload.source_metadata.provenance as Row
  const currentFingerprint = String(before.source?.content_fingerprint)
  if (currentFingerprint !== PHASE10_PROVENANCE_REPAIR.beforeFingerprint) throw new Error('failed_closed: exact BEFORE fingerprint mismatch')
  const afterFingerprint = before.source?.repair_fingerprint
  if (typeof afterFingerprint === 'string' && SHA256.test(afterFingerprint) && currentFingerprint === afterFingerprint) throw new Error('failed_closed: fingerprint transition is not deterministic')
  await assertBefore(adapter, before, 'canonical ingest_source')
  const ingested = await adapter.ingestSource(payload)
  const next = String(ingested.content_fingerprint ?? '')
  if (!SHA256.test(next) || next === PHASE10_PROVENANCE_REPAIR.beforeFingerprint) throw new Error('failed_closed: canonical ingestion fingerprint did not transition')
  if (ingested.source_id !== PHASE10_PROVENANCE_REPAIR.sourceUuid || ingested.post_id !== PHASE10_PROVENANCE_REPAIR.postId) throw new Error('failed_closed: canonical ingest_source did not preserve identity')
  const fingerprinted = await adapter.inspect(PHASE10_PROVENANCE_REPAIR.sourceUuid, PHASE10_PROVENANCE_REPAIR.postId)
  if (fingerprinted.source?.content_fingerprint !== next) throw new Error('failed_closed: fingerprint round-trip failed')
  assertHistorical(before, fingerprinted)

  let extraction: Row | null = null
  const extractionDone = ['extracted', 'no_event', 'needs_review', 'permanent_error'].includes(String(fingerprinted.extraction?.status ?? ''))
  if (!extractionDone) {
    await assertBefore(adapter, fingerprinted, 'normal extraction')
    extraction = await adapter.extractSource({ sourceId: PHASE10_PROVENANCE_REPAIR.sourceUuid, fingerprint: next, provenance: clone(provenance) })
    if (!same(extraction.provenance, provenance)) throw new Error('failed_closed: provenance round-trip failed')
  }
  const postExtraction = await adapter.inspect(PHASE10_PROVENANCE_REPAIR.sourceUuid, PHASE10_PROVENANCE_REPAIR.postId)
  assertHistorical(before, postExtraction)
  const extractionReady = ['extracted', 'no_event'].includes(String(postExtraction.extraction?.status ?? extraction?.status ?? ''))
  let indexing: Row | null = null
  const indexingDone = ['indexed', 'no_text', 'needs_review', 'permanent_error'].includes(String(postExtraction.indexing?.status ?? ''))
  if (extractionReady && !indexingDone) {
    await assertBefore(adapter, postExtraction, 'semantic indexing')
    indexing = await adapter.indexSource({ sourceId: PHASE10_PROVENANCE_REPAIR.sourceUuid, fingerprint: next, indexerVersion: PHASE10_PROVENANCE_REPAIR.indexerVersion, embeddingModel: PHASE10_PROVENANCE_REPAIR.embeddingModel, embeddingDimensions: PHASE10_PROVENANCE_REPAIR.embeddingDimensions })
    if (indexing.indexer_version !== PHASE10_PROVENANCE_REPAIR.indexerVersion || indexing.embedding_model !== PHASE10_PROVENANCE_REPAIR.embeddingModel || indexing.embedding_dimensions !== PHASE10_PROVENANCE_REPAIR.embeddingDimensions) throw new Error('failed_closed: semantic index contract mismatch')
  }
  const finalState = await adapter.inspect(PHASE10_PROVENANCE_REPAIR.sourceUuid, PHASE10_PROVENANCE_REPAIR.postId)
  assertHistorical(before, finalState)
  return redactProvenanceRepair({ mode: 'execute', outcome: 'completed', writes: 1 + (extraction ? 1 : 0) + (indexing ? 1 : 0), fingerprint: next, extraction, indexing, finalState }) as Record<string, unknown>
}

if (import.meta.main) {
  loadEnvLocal()
  try {
    const args = parseProvenanceRepairArguments(process.argv.slice(2))
    // A real adapter is deliberately not silently fabricated. Deployment must wire the audited normal-path adapter.
    if (!args.execute) console.log(JSON.stringify(await runProvenanceRepair(), null, 2))
    else throw new Error('failed_closed: normal extraction/indexing adapter is not configured')
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
}
