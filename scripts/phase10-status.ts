/** Read-only Phase 10 operator report. It never calls an RPC that mutates data. */
import process from 'node:process'
import { existsSync, readFileSync } from 'node:fs'

type Row = Record<string, unknown>
const fields = 'source_id,source_status,extraction_status,extraction_attempt_count,indexing_status,indexing_attempt_count'

/** Load the documented local environment file without printing or overwriting the process environment. */
export function loadEnvLocal(path = '.env.local'): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s][^=]*)=(.*)$/)
    if (!match) continue
    const [, name, rawValue] = match
    if (process.env[name] !== undefined) continue
    const value = rawValue.trim().replace(/^("|')(.*)\1$/, '$2')
    process.env[name] = value
  }
}

export function summarize(rows: Row[]) {
  const count = (field: string) => Object.fromEntries([...new Set(rows.map((row) => String(row[field] ?? 'unknown')))].sort().map((value) => [value, rows.filter((row) => String(row[field] ?? 'unknown') === value).length]))
  return { sources: rows.length, source_status: count('source_status'), extraction_status: count('extraction_status'), indexing_status: count('indexing_status') }
}

export async function fetchStatus(url: string, key: string): Promise<Row[]> {
  const response = await fetch(`${url}/rest/v1/orchestration_status?select=${fields}&order=source_id`, { headers: { apikey: key, authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`phase10 status ${response.status}`)
  const body: unknown = await response.json()
  if (!Array.isArray(body)) throw new Error('status response must be an array')
  return body as Row[]
}

if (import.meta.main) {
  loadEnvLocal()
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required')
  console.log(JSON.stringify({ phase: 10, read_only: true, ...summarize(await fetchStatus(url, key)) }, null, 2))
}
