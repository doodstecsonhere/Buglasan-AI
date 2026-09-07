declare const Deno: {
  env: {
    get(name: string): string | undefined
  }
}

const DIAGNOSTIC_TOKEN_ENV = 'CHAT_DIAGNOSTIC_TOKEN'
const DIAGNOSTIC_TOKEN_HEADER = 'x-chat-diagnostic-token'

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  let difference = leftBytes.length ^ rightBytes.length

  for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return difference === 0
}

/**
 * Authorizes only a future, server-side chat diagnostic request.
 * This helper is intentionally not connected to ordinary chat handling.
 */
export function isAuthorizedDiagnosticRequest(req: Request): boolean {
  const configuredSecret = Deno.env.get(DIAGNOSTIC_TOKEN_ENV) ?? ''
  const suppliedSecret = req.headers.get(DIAGNOSTIC_TOKEN_HEADER) ?? ''

  if (!configuredSecret.trim() || !suppliedSecret.trim()) return false
  return constantTimeEqual(suppliedSecret, configuredSecret)
}
