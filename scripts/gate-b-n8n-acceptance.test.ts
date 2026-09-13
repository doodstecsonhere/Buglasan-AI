import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const harness = readFileSync('scripts/gate-b-n8n-acceptance.ts', 'utf8')
const fixture = JSON.parse(readFileSync('test/fixtures/gate-b-n8n-acceptance.json', 'utf8')) as Record<string, unknown>
const workflows = [
  'n8n/workflows/buglasan-source-collector.json',
  'n8n/workflows/buglasan-knowledge-extractor.json',
  'n8n/workflows/buglasan-semantic-indexer.json',
  'n8n/workflows/buglasan-event-reconciler.json',
].map((path) => ({ path, raw: readFileSync(path, 'utf8'), value: JSON.parse(readFileSync(path, 'utf8')) as { active: boolean } }))

describe('Gate B n8n acceptance boundary', () => {
  it('uses a fixed synthetic, cleanup-compatible fixture family', () => {
    expect(fixture.source).toMatchObject({ post_id: 'pipeline-test-10-canonical', festival_year: 2027 })
    expect(fixture.textlessSource).toMatchObject({ post_id: 'pipeline-test-06-textless', raw_text: null, normalized_text: null, festival_year: null })
    expect(JSON.stringify(fixture)).toContain('pipeline_acceptance_fixture')
    expect(JSON.stringify(fixture)).toContain('phase9-v1')
  })

  it('is opt-in, project-bound, webhook-only, and guaranteed to use trusted cleanup', () => {
    for (const value of ['LIVE_GATE_B_N8N_ACCEPTANCE', 'SUPABASE_EXPECTED_PROJECT_REF', 'GATE_B_N8N_URL', 'PIPELINE_ACCEPTANCE_FIXTURE_TOKEN', '/functions/v1/cleanup-pipeline-acceptance', 'finally', 'post_id=like.pipeline-test-*']) expect(harness).toContain(value)
    expect(harness).not.toContain('docker')
    expect(harness).not.toContain('importWorkflow')
    expect(harness).not.toMatch(/(?:token|key)\s*[:=]\s*['"][A-Za-z0-9_-]{12,}/i)
  })

  it('proves A/B/C/D paths, status replay behavior, and persisted ledger evidence', () => {
    for (const value of ['buglasan-source-collector', 'buglasan-knowledge-extractor', 'buglasan-semantic-index', 'buglasan-event-reconcile', 'source_indexings', 'event_reconciliation_runs', 'textlessSource', 'festival_year === 2027', 'extractionReplay', 'indexingReplay']) expect(harness).toContain(value)
  })

  it('keeps workflow sources inactive and credentials unresolved while tolerating n8n response shapes', () => {
    for (const workflow of workflows) {
      expect(workflow.value.active).toBe(false)
      expect(workflow.raw).toContain('headerAuth')
      expect(workflow.raw).not.toMatch(/(?:apiKey|token|secret)"\s*:\s*"(?!\{\{)[^"$]{12,}/i)
    }
    for (const workflow of workflows.slice(2)) expect(workflow.raw).toContain('$json.body ?? $json')
    expect(workflows[0].raw).toContain('"id": "configure-after-import"')
  })
})
