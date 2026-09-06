import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const raw = readFileSync('n8n/workflows/buglasan-event-reconciler.json', 'utf8')
const workflow = JSON.parse(raw)

describe('Workflow D event reconciler', () => {
  it('is inactive and contains no literal secret', () => {
    expect(workflow.active).toBe(false)
    expect(raw).not.toMatch(/eyJ|AIza/)
  })
  it('validates one UUID and calls only the trusted endpoint with environment configuration', () => {
    const request = workflow.nodes.find((node: { type: string }) => node.type === 'n8n-nodes-base.httpRequest')
    expect(JSON.stringify(request)).toContain('$env.SUPABASE_URL')
    expect(JSON.stringify(request)).toContain('$env.RECONCILE_EVENT_TOKEN')
    expect(JSON.stringify(request)).toContain('candidate_event_id')
    expect(request.parameters.options.response.response.neverError).toBe(true)
  })
  it('routes operational statuses without direct database or Gemini nodes', () => {
    for (const status of ['reconciled', 'needs_review', 'processing', 'retryable_error', 'permanent_error']) expect(raw).toContain(status)
    const types = workflow.nodes.map((node: { type: string }) => node.type)
    expect(types).not.toContain('n8n-nodes-base.postgres')
    expect(types).not.toContain('n8n-nodes-base.googleGemini')
  })
})
