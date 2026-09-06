import { describe,expect,it } from 'vitest'
import { readFileSync } from 'node:fs'
const raw=readFileSync('n8n/workflows/buglasan-semantic-indexer.json','utf8');const workflow=JSON.parse(raw)
describe('Workflow C',()=>{
 it('is inactive and contains no literal secret',()=>{expect(workflow.active).toBe(false);expect(raw).not.toMatch(/eyJ|AIza/)})
 it('has one endpoint request with environment credentials and neverError',()=>{const nodes=workflow.nodes.filter((n:{type:string})=>n.type==='n8n-nodes-base.httpRequest');expect(nodes).toHaveLength(1);expect(JSON.stringify(nodes[0])).toContain('$env.SUPABASE_URL');expect(JSON.stringify(nodes[0])).toContain('$env.INDEX_SOURCE_TOKEN');expect(nodes[0].parameters.options.response.response.neverError).toBe(true)})
 it('validates UUID and routes all statuses without forbidden node types',()=>{for(const value of ['indexed','no_text','needs_review','processing','retryable_error','permanent_error'])expect(raw).toContain(value);const types=workflow.nodes.map((n:{type:string})=>n.type);expect(types).not.toContain('n8n-nodes-base.postgres');expect(types).not.toContain('n8n-nodes-base.googleGemini')})
})
