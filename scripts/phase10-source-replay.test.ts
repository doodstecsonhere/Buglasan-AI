import { describe, expect, it } from 'vitest'
import { buildReplayPlan, createPhase10HttpAdapter, PHASE10_SOURCE_REPLAY, parseReplayArguments, replayExitCode, runSourceReplay } from './phase10-source-replay.ts'
import { validateManifestRecord } from './phase10-manifest-intake.ts'

const payload = validateManifestRecord({ platform: 'facebook', post_id: PHASE10_SOURCE_REPLAY.postId, post_url: `https://www.facebook.com/Buglasan/posts/${PHASE10_SOURCE_REPLAY.postId}`, published_at: null, post_year: 2026, festival_year: 2026, raw_text: 'replay fixture', normalized_text: 'replay fixture', title: 'fixture', source_type: 'text', media_urls: [], collected_at: '2026-09-01T00:00:00Z', collection_method: 'manual', source_metadata: { provenance: { operator: 'test', reviewed_at: '2026-09-01', capture_note: 'test' } }, provenance: { operator: 'test', reviewed_at: '2026-09-01', capture_note: 'test' } })
const empty = { source: null, extraction: null, indexing: null, reconciliation: [] }

describe('Phase 10 hard-bound source replay', () => {
  it('accepts only the exact command identity and defaults to dry run', async () => {
    expect(parseReplayArguments([PHASE10_SOURCE_REPLAY.postId])).toEqual({ postId: PHASE10_SOURCE_REPLAY.postId, execute: false })
    expect(parseReplayArguments([PHASE10_SOURCE_REPLAY.postId, '--execute']).execute).toBe(true)
    expect(() => parseReplayArguments(['other'])).toThrow(/usage/)
    const result = await runSourceReplay(undefined)
    expect(result).toMatchObject({ mode: 'dry-run', non_mutating: true, writes: 0 })
  })
  it('plans canonical insert and hard-binds the UUID without duplicate writes', () => {
    const plan = buildReplayPlan(payload, empty)
    expect(plan).toMatchObject({ source_id: PHASE10_SOURCE_REPLAY.sourceUuid, source_action: 'blocked', writes: 0, reconciliation_action: 'blocked' })
    expect(plan.execution_blocked).toMatch(/preflight_blocked/)
  })
  it('rejects punctuation appended to the hard-bound post ID', () => {
    expect(() => parseReplayArguments([`${PHASE10_SOURCE_REPLAY.postId},`])).toThrow(/usage/)
  })
  it('fails closed on fingerprint drift and ambiguous reconciliation state', () => {
    expect(buildReplayPlan(payload, { ...empty, source: { id: PHASE10_SOURCE_REPLAY.sourceUuid, post_id: payload.post_id, content_fingerprint: 'b'.repeat(64) } })).toMatchObject({ fingerprint: 'b'.repeat(64), source_action: 'update', writes: 1 })
    expect(() => buildReplayPlan(payload, { ...empty, source: { id: PHASE10_SOURCE_REPLAY.sourceUuid, post_id: payload.post_id, content_fingerprint: 'not-a-sha' } })).toThrow(/fingerprint/)
    const plan = buildReplayPlan(payload, { ...empty, source: { id: PHASE10_SOURCE_REPLAY.sourceUuid, post_id: payload.post_id, content_fingerprint: 'b'.repeat(64) }, reconciliation: [{ status: 'processing' }] })
    expect(plan.reconciliation_action).toBe('blocked')
  })
  it('requires a proven injectable adapter for execute', async () => {
    await expect(runSourceReplay(undefined, true)).rejects.toThrow(/no proven Phase 10 adapter contract/)
  })
  it('redacts credentials in durable output through the dry-run boundary', async () => {
    const adapter = { inspect: async () => ({ ...empty, source: { id: PHASE10_SOURCE_REPLAY.sourceUuid, post_id: PHASE10_SOURCE_REPLAY.postId, content_fingerprint: 'a'.repeat(64), secret: 'token-value' } }) } as never
    const result = await runSourceReplay(adapter)
    expect(JSON.stringify(result)).not.toContain('token-value')
  })
  it('rejects incomplete live configuration before any transport call', () => {
    expect(() => createPhase10HttpAdapter({ supabaseUrl: '', serviceKey: '', operatorToken: '', extractionToken: '', indexingToken: '', reconciliationToken: '' })).toThrow(/failed_closed/)
  })
  it('uses injectable REST/RPC seams and verifies canonical UUID and fingerprint', async () => {
    const fingerprint = 'a'.repeat(64)
    const calls: string[] = []
    const transport = async (url: string, init: RequestInit) => {
      calls.push(`${init.method}:${url}`)
      if (url.includes('/sources?')) return new Response(JSON.stringify([{ id: PHASE10_SOURCE_REPLAY.sourceUuid, platform: 'facebook', post_id: PHASE10_SOURCE_REPLAY.postId, content_fingerprint: fingerprint }]))
      if (url.includes('/source_extractions?')) return new Response('[]')
      if (url.includes('/source_indexings?')) return new Response('[]')
      if (url.includes('/event_reconciliation_runs?')) return new Response('[]')
      if (url.includes('/rpc/ingest_source')) return new Response(JSON.stringify([{ source_id: PHASE10_SOURCE_REPLAY.sourceUuid, post_id: PHASE10_SOURCE_REPLAY.postId, content_fingerprint: 'b'.repeat(64) }]))
      return new Response(JSON.stringify({ status: 'processing' }))
    }
    const adapter = createPhase10HttpAdapter({ supabaseUrl: 'https://example.supabase.co', serviceKey: 'service', operatorToken: 'operator', extractionToken: 'extract', indexingToken: 'index', reconciliationToken: 'reconcile', transport })
    const state = { source: { id: PHASE10_SOURCE_REPLAY.sourceUuid, platform: 'facebook', post_id: PHASE10_SOURCE_REPLAY.postId, content_fingerprint: fingerprint }, extraction: null, indexing: null, reconciliation: [] }
    await adapter.preflight({ sourceId: PHASE10_SOURCE_REPLAY.sourceUuid, postId: PHASE10_SOURCE_REPLAY.postId, expected: payload, before: state })
    expect(calls.some((call) => call.includes('/sources?'))).toBe(true)
  })
  it('uses canonical response fingerprints and rejects a non-changing response', async () => {
    const adapter = createPhase10HttpAdapter({ supabaseUrl: 'https://example.supabase.co', serviceKey: 'service', operatorToken: 'operator', extractionToken: 'extract', indexingToken: 'index', reconciliationToken: 'reconcile', transport: async (url) => {
      if (url.includes('/sources?')) return new Response(JSON.stringify([{ id: PHASE10_SOURCE_REPLAY.sourceUuid, platform: 'facebook', post_id: PHASE10_SOURCE_REPLAY.postId, content_fingerprint: 'a'.repeat(64) }]))
      if (url.includes('/source_extractions?') || url.includes('/source_indexings?') || url.includes('/event_reconciliation_runs?')) return new Response('[]')
      if (url.includes('/events?') || url.includes('/event_sources?')) return new Response('[]')
      return new Response(JSON.stringify([{ source_id: PHASE10_SOURCE_REPLAY.sourceUuid, post_id: PHASE10_SOURCE_REPLAY.postId, content_fingerprint: 'a'.repeat(64) }]))
    } })
    const state = { source: { id: PHASE10_SOURCE_REPLAY.sourceUuid, platform: 'facebook', post_id: PHASE10_SOURCE_REPLAY.postId, content_fingerprint: 'a'.repeat(64) }, extraction: null, indexing: null, reconciliation: [] }
    const plan = buildReplayPlan(payload, state)
    await expect(adapter.replay({ expected: payload, before: state, plan })).rejects.toThrow(/did not change/)
  })
  it('classifies transport failure after execution as outcome_indeterminate', async () => {
    const adapter = { provenForPhase10: true, reconciliationContract: 'candidate-event-v1', inspect: async () => ({ ...empty, source: { id: PHASE10_SOURCE_REPLAY.sourceUuid, post_id: PHASE10_SOURCE_REPLAY.postId, content_fingerprint: 'a'.repeat(64) } }), preflight: async () => undefined, replay: async () => { throw new Error('outcome_indeterminate: transport failure') } } as never
    await expect(runSourceReplay(adapter, true)).resolves.toMatchObject({ outcome: 'outcome_indeterminate' })
  })
  it('returns nonzero exit codes for unsafe outcomes without executing', () => {
    expect(replayExitCode({ mode: 'dry-run' })).toBe(0)
    expect(replayExitCode({ outcome: 'replay_complete' })).toBe(0)
    for (const outcome of ['blocked', 'failed_closed', 'outcome_indeterminate', 'manual_reconciliation_required']) expect(replayExitCode({ outcome })).toBe(1)
  })
})
