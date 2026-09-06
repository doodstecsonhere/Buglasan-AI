import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const load = (name: string) => {
  const raw = readFileSync(`n8n/workflows/${name}`, 'utf8')
  return { raw, workflow: JSON.parse(raw) as { active: boolean; nodes: Array<{ name: string; type: string }>; connections: Record<string, { main: Array<Array<{ node: string }>> }> } }
}

describe('Phase 9 A/B/C/D workflow contracts', () => {
  it('keeps all four contracts inactive, authenticated, and secret-free', () => {
    for (const name of ['buglasan-source-collector.json','buglasan-knowledge-extractor.json','buglasan-semantic-indexer.json','buglasan-event-reconciler.json']) {
      const { raw, workflow } = load(name)
      expect(workflow.active).toBe(false)
      expect(raw).toContain('headerAuth')
      expect(raw).not.toMatch(/(?:eyJ|AIza|sb_secret_|service-role-key)/i)
      expect(raw).not.toMatch(/retryOnFail|loopOverItems|splitInBatches/)
    }
  })
  it('fans changed source ingestion independently to B and C through the service planner', () => {
    const { raw } = load('buglasan-source-collector.json')
    expect(raw).toContain('get_orchestration_dispatch')
    expect(raw).toContain('Dispatch Workflow B')
    expect(raw).toContain('Dispatch Workflow C')
    expect(raw).toContain('N8N_INTERNAL_ORCHESTRATION_TOKEN')
  })
  it('lets B dispatch D only for planner-approved current candidate IDs', () => {
    const { raw } = load('buglasan-knowledge-extractor.json')
    expect(raw).toContain('Get Safe Candidate Dispatch Plan')
    expect(raw).toContain('Emit Safe Current Candidate IDs')
    expect(raw).toContain('Dispatch Workflow D Per Candidate')
    expect(raw).toContain('candidate_event_id')
    expect(raw).toContain('Normalize Safe Extraction Status')
    expect(raw).toContain('candidate_event_ids:[]')
  })
  it('fans A dispatches from the validated plan rather than from its webhook response', () => {
    const { workflow } = load('buglasan-source-collector.json')
    const { connections } = workflow
    const targets = connections['Validate Dispatch Plan'].main[0].map(({ node }) => node)
    expect(targets).toEqual(expect.arrayContaining(['Respond', 'Emit Recoverable Candidate IDs', 'Dispatch Extraction?', 'Dispatch Indexing?']))
    expect(connections.Respond.main[0]).toEqual([])
  })
  it('has one reachable webhook response before asynchronous candidate fanout', () => {
    for (const name of ['buglasan-source-collector.json', 'buglasan-knowledge-extractor.json']) {
      const { raw, workflow } = load(name)
      const responses = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.respondToWebhook')
      expect(responses).toHaveLength(1)
      expect(raw).toContain('Malformed orchestration dispatch plan')
      expect(raw).toContain('candidate_event_ids.length')
      expect(raw).toContain('has_more_candidates')
    }
  })
})
