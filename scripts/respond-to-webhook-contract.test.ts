import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Node = {
  name: string
  type: string
  typeVersion: number
  parameters: Record<string, unknown>
}

type Workflow = {
  nodes: Node[]
  connections: Record<string, { main?: Array<Array<{ node: string }>> }>
}

const workflowFiles = [
  'buglasan-source-collector.json',
  'buglasan-knowledge-extractor.json',
  'buglasan-semantic-indexer.json',
  'buglasan-event-reconciler.json',
] as const

const supportedRespondToWebhookTypeVersions = [1.4]

const loadWorkflow = (filename: string): Workflow =>
  JSON.parse(readFileSync(`n8n/workflows/${filename}`, 'utf8')) as Workflow

const reachableNodeNames = (workflow: Workflow, starts: string[]) => {
  const reachable = new Set(starts)
  const pending = [...starts]

  while (pending.length > 0) {
    const name = pending.pop()!
    for (const branch of workflow.connections[name]?.main ?? []) {
      for (const { node } of branch) {
        if (!reachable.has(node)) {
          reachable.add(node)
          pending.push(node)
        }
      }
    }
  }

  return reachable
}

describe('checked-in n8n Respond to Webhook response contracts', () => {
  it.each(workflowFiles)('%s has one reachable, explicit JSON responder', (filename) => {
    const workflow = loadWorkflow(filename)
    const webhooks = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.webhook')
    const responders = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.respondToWebhook')

    expect(webhooks).toHaveLength(1)
    expect(webhooks[0].parameters.responseMode).toBe('responseNode')
    expect(responders).toHaveLength(1)
    expect(supportedRespondToWebhookTypeVersions).toContain(responders[0].typeVersion)

    const reachable = reachableNodeNames(workflow, webhooks.map(({ name }) => name))
    expect(reachable.has(responders[0].name)).toBe(true)
    expect(responders.filter(({ name }) => reachable.has(name))).toHaveLength(1)

    expect(responders[0].parameters.respondWith).toBe('json')
    expect(responders[0].parameters.responseBody).toEqual(expect.any(String))
    expect((responders[0].parameters.responseBody as string).trim()).not.toBe('')
    expect(responders[0].parameters.options).toMatchObject({ responseCode: 200 })
  })

  it('keeps Workflow A response fields as an object expression, not a stringified payload', () => {
    const workflow = loadWorkflow('buglasan-source-collector.json')
    const responder = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.respondToWebhook')!
    const responseBody = responder.parameters.responseBody as string

    expect(responseBody).toMatch(/^=\{\{\s*\{[\s\S]*\}\s*\}\}$/)
    expect(responseBody).not.toContain('JSON.stringify')
    for (const field of [
      'source_id',
      'accepted',
      'extraction',
      'indexing',
      'candidate_dispatch_count',
      'has_more_candidates',
      'remaining_candidate_count',
    ]) {
      expect(responseBody).toMatch(new RegExp(`\\b${field}\\s*:`, ''))
    }
  })
})
