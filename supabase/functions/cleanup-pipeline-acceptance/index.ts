export {}

// The repository TypeScript project does not load Deno's ambient types. This
// narrow declaration keeps the function type-checkable in the editor while
// Supabase/Deno supplies the runtime global.
declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
let KEY = ''
try {
  KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? ''
} catch {
  // Treat malformed secret configuration as an unconfigured function.
}
const TOKEN = Deno.env.get('PIPELINE_ACCEPTANCE_FIXTURE_TOKEN') ?? ''

function equal(actual: string, expected: string): boolean {
  const left = new TextEncoder().encode(actual); const right = new TextEncoder().encode(expected)
  let difference = left.length ^ right.length
  for (let index = 0; index < Math.max(left.length, right.length); index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return difference === 0
}
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!SUPABASE_URL || !KEY || !TOKEN) return json(503, { error: 'server_not_configured' })
  if (!equal(request.headers.get('x-pipeline-acceptance-fixture-token') ?? '', TOKEN)) return json(401, { error: 'unauthorized' })
  try {
    const result = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cleanup_pipeline_acceptance_fixtures`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })
    const body = await result.text()
    return result.ok
      ? new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
      : json(500, { error: 'cleanup_failed' })
  } catch {
    return json(502, { error: 'cleanup_unreachable' })
  }
})
