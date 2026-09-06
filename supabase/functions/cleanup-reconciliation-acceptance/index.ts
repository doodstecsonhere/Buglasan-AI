import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const URL = Deno.env.get('SUPABASE_URL') ?? ''
const KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? ''
const TOKEN = Deno.env.get('RECONCILIATION_ACCEPTANCE_FIXTURE_TOKEN') ?? ''
const FIXTURE_IDS = [
  'reconciliation-test-01-create', 'reconciliation-test-02-identical', 'reconciliation-test-03-reschedule',
  'reconciliation-test-04-cancellation', 'reconciliation-test-05-conflicting-date', 'reconciliation-test-06-distinct',
  'reconciliation-test-07-registration-extension', 'reconciliation-test-08-venue-change', 'reconciliation-test-09-postponement',
  'reconciliation-test-10-new-schedule', 'reconciliation-test-11-null-year', 'reconciliation-test-12-replay',
] as const

function equal(actual: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(actual)
  const right = encoder.encode(expected)
  let difference = left.length ^ right.length
  for (let index = 0; index < Math.max(left.length, right.length); index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return difference === 0
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!URL || !KEY || !TOKEN) return json(503, { error: 'server_not_configured' })
  if (!equal(request.headers.get('x-reconciliation-acceptance-fixture-token') ?? '', TOKEN)) return json(401, { error: 'unauthorized' })
  const result = await fetch(`${URL}/rest/v1/rpc/cleanup_reconciliation_acceptance_fixtures`, {
    method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_fixture_ids: FIXTURE_IDS }),
  })
  const body = await result.text()
  if (!result.ok) return json(500, { error: 'cleanup_failed' })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
})
