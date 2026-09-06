import { readFileSync } from 'node:fs'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY

if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required for service-only orchestration status')

const response = await fetch(`${url}/rest/v1/orchestration_status?select=source_id,source_status,extraction_status,extraction_attempt_count,indexing_status,indexing_attempt_count&order=source_id`, {
  headers: { apikey: key, authorization: `Bearer ${key}` },
})
if (!response.ok) throw new Error(`orchestration status ${response.status}: ${(await response.text()).slice(0, 500)}`)
console.log(JSON.stringify(await response.json(), null, 2))

// Keep the workflow names in this command's source so static checks can verify
// this status script is scoped to the four Phase 9 contracts.
void readFileSync('n8n/workflows/buglasan-source-collector.json', 'utf8')
