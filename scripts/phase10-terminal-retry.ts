/** Repository-only inspection. No live execution path until reconciliation is proven safe. */
import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs'
import process from 'node:process'

export const PROJECT = 'https://uelezensmkxfyexcwqzb.supabase.co'
export const SOURCE_IDS = Object.freeze([
  '0f73eba4-daa0-48ca-82a8-a4ae02284793',
  '2d9a28eb-a142-4bc2-b694-530d141e0cbc',
  '8f0d3c75-a084-410c-8d1b-0800655cec21',
  'b025846e-1928-4ac9-95dd-cf02972dd0dc',
] as const)

export async function inspect(key: string, request: typeof fetch = fetch) {
  if (!key) throw new Error('operator service credential required')
  const snapshots = []
  // Sequential GET only, fixed four; no excluded source lookup, RPC, or network retry.
  for (const id of SOURCE_IDS) {
    const rows = []
    for (const path of [`sources?id=eq.${id}&select=*`, `source_extractions?source_id=eq.${id}&extractor_version=eq.phase6-v1&select=*`, `events?extracted_source_id=eq.${id}&select=id`, `event_sources?source_id=eq.${id}&select=event_id`]) {
      const response = await request(`${PROJECT}/rest/v1/${path}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { apikey: key, authorization: `Bearer ${key}` },
      })
      if (!response.ok) throw new Error(`inspection failed: HTTP ${response.status}; do not retry automatically`)
      const body: unknown = await response.json()
      if (!Array.isArray(body)) throw new Error('invalid inspection response')
      rows.push(body)
    }
    if (rows[0].length !== 1) throw new Error('source missing or ambiguous')
    snapshots.push({ source_id: id, source: rows[0][0], extractions: rows[1], candidates: rows[2], links: rows[3] })
  }
  return { project: PROJECT, read_only: true, execution_blocked: 'deployed v35 reconciliation configuration unproven; no capability-bound bypass', snapshots }
}

export function assertInspectionOnly(args: string[]) {
  if (args.length > 1 || (args[0] !== undefined && args[0] !== '--inspect')) {
    throw new Error('STOP: execution is not implemented or authorized; inspection only')
  }
}

export async function recordInspection(key: string, receiptPath: string, request: typeof fetch = fetch) {
  // No automatic .env loading. Reserve/fsync receipt BEFORE the first network request.
  const fd = openSync(receiptPath, 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify({ state: 'inspection_started', project: PROJECT })); fsyncSync(fd)
    const report = await inspect(key, request)
    // Append a separate completed record; a failed run leaves a durable started receipt.
    writeFileSync(fd, '\n' + JSON.stringify(report)); fsyncSync(fd)
    return report
  } finally { closeSync(fd) }
}

if (import.meta.main) {
  assertInspectionOnly(process.argv.slice(2))
  await recordInspection(process.env.SUPABASE_SECRET_KEY ?? '', 'phase10-terminal-retry-inspection.json')
  console.log('Read-only inspection recorded. Live retry remains blocked.')
}
