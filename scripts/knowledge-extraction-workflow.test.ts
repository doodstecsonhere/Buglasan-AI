import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const raw = readFileSync(new URL('../n8n/workflows/buglasan-knowledge-extractor.json', import.meta.url), 'utf8')
const workflow = JSON.parse(raw)

describe('Workflow B artifact', () => {
  it('is inactive, secret-free, source-id driven, and independent', () => {
    expect(workflow.active).toBe(false)
    expect(raw).toContain('source_id')
    expect(raw).toContain("$env.EXTRACT_SOURCE_TOKEN")
    expect(raw).not.toMatch(/(?:eyJ|service-role-key|gemini-api-key)/i)
    expect(raw).not.toContain('buglasan-source-collector')
    expect(workflow.nodes[0].parameters.authentication).toBe('headerAuth')
    expect(workflow.nodes[0].credentials.httpHeaderAuth.id).toBe('configure-after-import')
  })
  it('calls once and branches statuses without nested retry nodes', () => {
    expect(workflow.nodes.filter((node: { type: string }) => node.type === 'n8n-nodes-base.httpRequest')).toHaveLength(1)
    for (const status of ['extracted','no_event','needs_review','retryable_error']) expect(raw).toContain(status)
    expect(raw).not.toMatch(/retryOnFail|loopOverItems|splitInBatches/)
    expect(workflow.nodes[1].parameters.options.response.response.neverError).toBe(true)
  })
  it('has gateway and live-harness regression configuration', () => {
    const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
    const harness = readFileSync(new URL('./knowledge-extraction-live.ts', import.meta.url), 'utf8')
    expect(config).toContain('[functions.extract-source]')
    expect(config).toContain('verify_jwt = false')
    expect(harness).toContain("row.post_id.startsWith(prefix)")
    expect(harness).toContain('extracted_source_id=in.(${ids})')
    expect(harness).toContain('JSON.stringify(after) !== JSON.stringify(before)')
    expect(harness).not.toMatch(/source_extractions\?select=.*limit=1/)
  })
})
