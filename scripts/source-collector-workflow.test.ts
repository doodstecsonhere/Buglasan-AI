import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type WorkflowNode = {
  name: string
  type: string
  parameters: Record<string, unknown>
  credentials?: Record<string, { id?: string; name?: string }>
}

const workflowText = readFileSync(
  new URL('../n8n/workflows/buglasan-source-collector.json', import.meta.url),
  'utf8',
)
const workflow = JSON.parse(workflowText) as {
  active: boolean
  nodes: WorkflowNode[]
  connections: Record<string, { main: Array<Array<{ node: string }>> }>
}

describe('source collector workflow security boundary', () => {
  it('is inactive and protects the inbound webhook with an unresolved Header Auth credential reference', () => {
    const webhook = workflow.nodes.find((node) => node.name === 'Source Webhook')
    expect(workflow.active).toBe(false)
    expect(webhook?.type).toBe('n8n-nodes-base.webhook')
    expect(webhook?.parameters.authentication).toBe('headerAuth')
    expect(webhook?.credentials?.httpHeaderAuth?.name).toBe('Buglasan Source Collector Header Auth')
    expect(webhook?.credentials?.httpHeaderAuth).not.toHaveProperty('value')
  })

  it('places authentication before every path to service-role ingestion', () => {
    const webhookTargets = workflow.connections['Source Webhook']?.main.flat().map(({ node }) => node)
    expect(webhookTargets).toEqual(['Normalize Canonical Payload'])
    expect(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.webhook')).toHaveLength(1)
    expect(workflow.connections['Validate Source Contract']?.main.flat().map(({ node }) => node))
      .toEqual(['Call Source Ingestion RPC'])
  })

  it('contains only server-side secret-key environment references and no committed credential values', () => {
    expect(workflowText).toContain('$env.SUPABASE_SECRET_KEY')
    expect(workflowText).not.toContain('Bearer ')
    expect(workflowText).not.toMatch(/sb_secret_[A-Za-z0-9_-]+/)
    expect(workflowText).not.toMatch(/service_role\s*[:=]\s*["'][^$]/i)
    expect(workflowText).not.toMatch(/(?:headerAuth|httpHeaderAuth)[\s\S]{0,200}"value"\s*:/i)
  })
})
