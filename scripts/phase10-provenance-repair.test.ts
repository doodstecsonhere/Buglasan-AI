import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadEnvLocal } from './phase10-status.ts'
import {
  PHASE10_PROVENANCE_REPAIR,
  loadTrustedProvenancePayload,
  parseProvenanceRepairArguments,
  redactProvenanceRepair,
  runProvenanceRepair,
  createProvenanceRepairHttpAdapter,
  createProvenanceRepairAdapterFromEnv,
  type RepairAdapter,
  type RepairState,
} from './phase10-provenance-repair.ts'

const manifestRecord = {
  platform: 'facebook', post_id: PHASE10_PROVENANCE_REPAIR.postId,
  post_url: `https://www.facebook.com/Buglasan/posts/${PHASE10_PROVENANCE_REPAIR.postId}`,
  published_at: null, post_year: 2026, festival_year: 2026,
  raw_text: 'audited provenance repair fixture', normalized_text: 'audited provenance repair fixture',
  title: 'fixture', source_type: 'text', media_urls: [], collected_at: '2026-09-01T00:00:00Z',
  collection_method: 'manual', source_metadata: {},
  provenance: { operator: 'test-operator', reviewed_at: '2026-09-01', capture_note: 'focused test' },
}
const manifestText = JSON.stringify(manifestRecord)
const readManifest = () => manifestText
const historical = { events: [{ id: 'event-1' }], links: [{ event_id: 'event-1' }], reviews: [{ id: 'review-1' }], reconciliation: [{ id: 'reconcile-1', status: 'reviewed' }] }

function state(overrides: Partial<RepairState> = {}): RepairState {
  return {
    source: { id: PHASE10_PROVENANCE_REPAIR.sourceUuid, post_id: PHASE10_PROVENANCE_REPAIR.postId, content_fingerprint: PHASE10_PROVENANCE_REPAIR.beforeFingerprint },
    extraction: null, indexing: null, historical: structuredClone(historical), ...overrides,
  }
}

function adapterFor(initial = state(), after = 'a'.repeat(64)): RepairAdapter {
  let current = structuredClone(initial)
  return {
    inspect: async () => structuredClone(current),
    ingestSource: async () => { current.source = { ...current.source, content_fingerprint: after }; return { source_id: PHASE10_PROVENANCE_REPAIR.sourceUuid, post_id: PHASE10_PROVENANCE_REPAIR.postId, content_fingerprint: after } },
    extractSource: async ({ fingerprint, provenance }) => { current.extraction = { status: 'extracted', source_fingerprint: fingerprint, provenance }; return { status: 'extracted', provenance } },
    indexSource: async ({ fingerprint, indexerVersion, embeddingModel, embeddingDimensions }) => { current.indexing = { status: 'indexed', source_fingerprint: fingerprint }; return { indexer_version: indexerVersion, embedding_model: embeddingModel, embedding_dimensions: embeddingDimensions } },
  }
}

describe('guarded Phase 10 provenance repair', () => {
  it('hard-binds identity, fingerprint, and trusted manifest', () => {
    expect(PHASE10_PROVENANCE_REPAIR).toMatchObject({ sourceUuid: '254d56af-7bf4-4913-8a9b-d5ab34367b33', postId: '1472636598234727', beforeFingerprint: '02f61ce417f0ea742c75167b155fa682cf8bfa5f4bd21cb16b8f4774b0f63753', manifestPath: 'operator-manifests/buglasan-2026-real-corpus-01.json' })
    expect(loadTrustedProvenancePayload(PHASE10_PROVENANCE_REPAIR.manifestPath, readManifest).post_id).toBe(PHASE10_PROVENANCE_REPAIR.postId)
    expect(() => loadTrustedProvenancePayload('other.json', readManifest)).toThrow(/trusted manifest path/)
  })

  it('defaults to dry-run and requires --execute for writes', async () => {
    expect(parseProvenanceRepairArguments([PHASE10_PROVENANCE_REPAIR.postId])).toEqual({ postId: PHASE10_PROVENANCE_REPAIR.postId, execute: false })
    expect(parseProvenanceRepairArguments([PHASE10_PROVENANCE_REPAIR.postId, '--execute']).execute).toBe(true)
    const result = await runProvenanceRepair({ readManifest })
    expect(result).toMatchObject({ mode: 'dry-run', non_mutating: true, writes: 0 })
    await expect(runProvenanceRepair({ execute: true, readManifest })).rejects.toThrow(/adapter/)
  })

  it('performs deterministic transition, round-trips provenance, and gates extraction/indexing on after fingerprint', async () => {
    const calls: string[] = []
    const adapter = adapterFor()
    const wrapped: RepairAdapter = {
      ...adapter,
      ingestSource: async payload => { calls.push(`ingest:${payload.post_id}`); return adapter.ingestSource(payload) },
      extractSource: async input => { calls.push(`extract:${input.fingerprint}`); return adapter.extractSource(input) },
      indexSource: async input => { calls.push(`index:${input.fingerprint}:${input.embeddingDimensions}`); return adapter.indexSource(input) },
    }
    const result = await runProvenanceRepair({ execute: true, adapter: wrapped, readManifest })
    expect(result).toMatchObject({ outcome: 'completed', fingerprint: 'a'.repeat(64) })
    expect(calls).toEqual([`ingest:${PHASE10_PROVENANCE_REPAIR.postId}`, `extract:${'a'.repeat(64)}`, `index:${'a'.repeat(64)}:768`])
  })

  it('preserves historical rows and has no terminal recovery or reconciliation mutation seam', async () => {
    const result = await runProvenanceRepair({ execute: true, adapter: adapterFor(), readManifest })
    const finalState = result.finalState as RepairState
    expect(finalState.historical).toEqual(historical)
    expect(Object.keys(adapterFor())).not.toContain('terminalRetry')
    expect(Object.keys(adapterFor())).not.toContain('reconcile')
  })

  it('is resumable/idempotent when extraction and indexing are already terminal', async () => {
    const calls: string[] = []
    const adapter = adapterFor({ ...state(), extraction: { status: 'extracted' }, indexing: { status: 'indexed' } })
    const guarded = { ...adapter, extractSource: async () => { calls.push('extract'); return {} }, indexSource: async () => { calls.push('index'); return {} } }
    const result = await runProvenanceRepair({ execute: true, adapter: guarded, readManifest })
    expect(result.outcome).toBe('completed')
    expect(calls).toEqual([])
  })

  it('fails closed on exact before-image mismatch and unchanged transition', async () => {
    const mismatch = adapterFor({ ...state(), source: { ...state().source!, content_fingerprint: 'b'.repeat(64) } })
    await expect(runProvenanceRepair({ execute: true, adapter: mismatch, readManifest })).rejects.toThrow(/BEFORE fingerprint/)
    await expect(runProvenanceRepair({ execute: true, adapter: adapterFor(state(), PHASE10_PROVENANCE_REPAIR.beforeFingerprint), readManifest })).rejects.toThrow(/did not transition/)
  })

  it('redacts secrets and preserves process env precedence through the shared loader', () => {
    expect(JSON.stringify(redactProvenanceRepair({ operatorToken: 'secret-value', nested: { password: 'pw' } }))).not.toContain('secret-value')
    const directory = mkdtempSync(join(tmpdir(), 'phase10-provenance-env-'))
    const file = join(directory, '.env.local')
    const previous = process.env.PHASE10_OPERATOR_TOKEN
    try {
      writeFileSync(file, 'PHASE10_OPERATOR_TOKEN=file-value\nSUPABASE_URL=https://file.example\n')
      process.env.PHASE10_OPERATOR_TOKEN = 'process-value'
      loadEnvLocal(file)
      expect(process.env.PHASE10_OPERATOR_TOKEN).toBe('process-value')
      expect(process.env.SUPABASE_URL).toBe('https://file.example')
    } finally {
      if (previous === undefined) delete process.env.PHASE10_OPERATOR_TOKEN; else process.env.PHASE10_OPERATOR_TOKEN = previous
      delete process.env.SUPABASE_URL
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses read-only canonical inspection and normal-path request contracts', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fingerprint = 'a'.repeat(64)
    const transport = async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/sources?')) return new Response(JSON.stringify([{ id: PHASE10_PROVENANCE_REPAIR.sourceUuid, post_id: PHASE10_PROVENANCE_REPAIR.postId, platform: 'facebook', content_fingerprint: fingerprint }]))
      return new Response('[]')
    }
    const adapter = createProvenanceRepairHttpAdapter({ supabaseUrl: 'https://example.supabase.co', serviceKey: 'service', operatorToken: 'operator', extractionToken: 'extract', indexingToken: 'index', transport })
    await adapter.inspect(PHASE10_PROVENANCE_REPAIR.sourceUuid, PHASE10_PROVENANCE_REPAIR.postId)
    expect(calls.every(({ init }) => init.method === 'GET')).toBe(true)
    expect(calls.every(({ init }) => (init.headers as Record<string, string>).apikey === 'service' && (init.headers as Record<string, string>).authorization === 'Bearer service')).toBe(true)
    expect(calls.some(({ url }) => url.includes('/event_reconciliation_runs?'))).toBe(true)
    expect(calls.some(({ url }) => url.includes('/event_reconciliation_reviews?'))).toBe(true)
  })

  it('authenticates canonical ingest and worker endpoints without terminal recovery headers or paths', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const transport = async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/rpc/ingest_source')) return new Response(JSON.stringify([{ source_id: PHASE10_PROVENANCE_REPAIR.sourceUuid, post_id: PHASE10_PROVENANCE_REPAIR.postId, content_fingerprint: 'a'.repeat(64) }]))
      return new Response(JSON.stringify({ status: 'processing' }))
    }
    const adapter = createProvenanceRepairHttpAdapter({ supabaseUrl: 'https://example.supabase.co', serviceKey: 'service', operatorToken: 'operator', extractionToken: 'extract', indexingToken: 'index', transport })
    const payload = loadTrustedProvenancePayload(PHASE10_PROVENANCE_REPAIR.manifestPath, readManifest)
    await adapter.ingestSource(payload)
    await adapter.extractSource({ sourceId: PHASE10_PROVENANCE_REPAIR.sourceUuid, fingerprint: 'a'.repeat(64), provenance: payload.source_metadata.provenance as Record<string, unknown> })
    await adapter.indexSource({ sourceId: PHASE10_PROVENANCE_REPAIR.sourceUuid, fingerprint: 'a'.repeat(64), indexerVersion: PHASE10_PROVENANCE_REPAIR.indexerVersion, embeddingModel: PHASE10_PROVENANCE_REPAIR.embeddingModel, embeddingDimensions: 768 })
    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual(['/rest/v1/rpc/ingest_source', '/functions/v1/extract-source', '/functions/v1/index-source'])
    expect(calls[0].init.headers).toMatchObject({ apikey: 'service', authorization: 'Bearer service' })
    expect(calls[1].init.headers).toMatchObject({ 'x-extraction-token': 'extract' })
    expect(calls[2].init.headers).toMatchObject({ 'x-index-source-token': 'index' })
    expect(calls.some(({ url }) => url.includes('terminal'))).toBe(false)
    expect(calls.some(({ init }) => Object.keys(init.headers as object).some(key => key.includes('operator')))).toBe(false)
  })

  it('constructs the CLI execute adapter from the shared env loader', () => {
    const previous = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'PHASE10_OPERATOR_TOKEN', 'EXTRACT_SOURCE_TOKEN', 'INDEX_SOURCE_TOKEN'].map(name => [name, process.env[name]]))
    try {
      Object.assign(process.env, { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'service', PHASE10_OPERATOR_TOKEN: 'operator', EXTRACT_SOURCE_TOKEN: 'extract', INDEX_SOURCE_TOKEN: 'index' })
      const adapter = createProvenanceRepairAdapterFromEnv()
      expect(adapter).toBeDefined()
      expect(adapter.inspect).toBeTypeOf('function')
    } finally {
      for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value
    }
  })
})
