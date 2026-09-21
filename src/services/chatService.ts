import type { ChatLanguage } from '../types'

const CHAT_REQUEST_TIMEOUT_MS = 30_000

export interface ChatRequest {
  message: string
  language?: ChatLanguage
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  signal?: AbortSignal
}

export interface ChatResponse {
  reply: string
}

export class ChatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatError'
  }
}

export class ChatTimeoutError extends ChatError {
  constructor() {
    super('The answer took too long. Please try again.')
    this.name = 'ChatTimeoutError'
  }
}

export function resolveChatEndpoint(): string {
  const configured = import.meta.env.VITE_CHAT_ENDPOINT ?? import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
  if (configured) return configured.replace(/\/$/, '')
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  if (supabaseUrl) return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/chat`
  throw new ChatError('Chat is not configured. Set VITE_CHAT_ENDPOINT or VITE_SUPABASE_URL.')
}

export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const url = resolveChatEndpoint()
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  request.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = globalThis.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: request.message, conversationHistory: request.conversationHistory }),
      signal: controller.signal,
    })
  } catch (error) {
    if (request.signal?.aborted) throw new ChatError('Request cancelled.')
    if (controller.signal.aborted) throw new ChatTimeoutError()
    throw new ChatError('Could not reach the chat service. Check your connection.')
  } finally {
    globalThis.clearTimeout(timeout)
    request.signal?.removeEventListener('abort', abortFromCaller)
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    if (response.status === 429) throw new ChatError('Too many messages. Please wait a moment and try again.')
    throw new ChatError(error.error || `HTTP ${response.status}`)
  }

  const data: unknown = await response.json().catch(() => {
    throw new ChatError('Invalid response from chat service.')
  })
  if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).reply !== 'string') {
    throw new ChatError('Invalid response from chat service.')
  }
  return { reply: (data as Record<string, unknown>).reply as string }
}
