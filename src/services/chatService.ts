/**
 * Buglasan AI - Chat Service Adapter
 * Unified interface for demo mode and live Supabase Edge Function.
 *
 * Phase 5: Demo response generation now derives ALL factual claims from
 * `demoSources` records (via `demoEventSources` linkage). It no longer hard-codes
 * any Buglasan facts. If a query asks about something with no backing source,
 * the demo returns an honest "no demo information found" message instead of
 * fabricating an answer.
 *
 * Phase 4: Response shape optionally includes `retrievedChunks` (semantic search
 * matches) returned by the live Edge Function. Demo mode returns an empty array
 * for backward compatibility.
 */

import type { Source, Event, FestivalYear, SourceCitation, ClaimCitation, ChatLanguage } from '../types'
import { resolveFestivalYear, getCurrentFestivalYear } from '../utils/dateUtils'
import { answerOffline, saveVerifiedKnowledge } from './offlineKnowledge'

const DEMO_MODE = import.meta.env.MODE === 'test' || __DEMO_BUILD__
const loadDemoRuntime = DEMO_MODE ? () => import('./demoChatRuntime') : null
const CHAT_REQUEST_TIMEOUT_MS = 45_000

/**
 * Production hosting on Cloudflare Pages does not proxy `/functions/v1/*` to
 * Supabase. Live mode therefore requires an explicit public Supabase endpoint
 * (or a same-origin proxy deliberately configured by the host), never an
 * implicit Pages-relative fallback.
 */
export function resolveChatEndpoint(config: ChatServiceConfig = {}): string {
  const configured = config.edgeFunctionUrl ?? import.meta.env.VITE_CHAT_ENDPOINT ?? import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
  if (configured) return configured.replace(/\/$/, '')

  const supabaseUrl = config.supabaseUrl ?? import.meta.env.VITE_SUPABASE_URL
  if (supabaseUrl) return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/chat`

  throw new ChatConfigurationError('Live chat is not configured. Set VITE_CHAT_ENDPOINT or VITE_SUPABASE_URL before publishing.')
}

export class ChatConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatConfigurationError'
  }
}

export class ChatTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Chat request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`)
    this.name = 'ChatTimeoutError'
  }
}

export class ChatRequestAbortedError extends Error {
  constructor() {
    super('Chat request was cancelled.')
    this.name = 'ChatRequestAbortedError'
  }
}

/** The Edge Function returned JSON, but not a response safe for the chat UI. */
export class ChatResponseValidationError extends Error {
  constructor(message = 'The chat service returned an incomplete response.') {
    super(message)
    this.name = 'ChatResponseValidationError'
  }
}

export interface ChatServiceConfig {
  demoMode?: boolean
  edgeFunctionUrl?: string
  supabaseUrl?: string
  supabasePublishableKey?: string
  requestTimeoutMs?: number
}

export interface ChatRequest {
  message: string
  festivalYear?: FestivalYear
  language?: ChatLanguage
  conversationHistory?: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: string
    sources?: SourceCitation[]
  }>
  signal?: AbortSignal
}

/**
 * Response shape from the chat endpoint.
 *
 * In live mode, the Edge Function returns the evidence packet it built
 * (sources, events, chunks). In demo mode we only return sources + events.
 *
 * `retrievedChunks` is optional to keep the demo-mode payload small and
 * to remain backward-compatible with older clients.
 */
export interface ChatResponse {
  message: {
    id: string
    role: 'assistant'
    content: string
    timestamp: string
    sources: SourceCitation[]
    festivalYear: FestivalYear
    claimCitations?: ClaimCitation[]
  }
  retrievedSources: Source[]
  retrievedEvents: Event[]
  retrievedChunks?: ChunkSummary[]
  yearResolved: FestivalYear
  language: ChatLanguage
}

/** Explicit instructions in the user's message override the UI/request language. */
export function resolveChatLanguage(message: string, requested: ChatLanguage = 'en'): ChatLanguage {
  const text = message.toLowerCase()
  if (/\b(in|use|reply|respond|answer|speak|write)\b[^.!?\n]{0,30}\b(cebuano|bisaya)\b|\b(cebuano|bisaya)\b[^.!?\n]{0,20}\b(reply|answer|please)\b/.test(text)) return 'ceb'
  if (/\b(in|use|reply|respond|answer|speak|write)\b[^.!?\n]{0,30}\b(filipino|tagalog)\b|\b(filipino|tagalog)\b[^.!?\n]{0,20}\b(reply|answer|please)\b/.test(text)) return 'fil'
  if (/\b(in|use|reply|respond|answer|speak|write)\b[^.!?\n]{0,30}\b(english)\b|\b(english)\b[^.!?\n]{0,20}\b(reply|answer|please)\b/.test(text)) return 'en'
  return requested
}

/**
 * Resolve only markers that point at the supplied evidence packet. Unknown,
 * out-of-range, and duplicate references are ignored; no source is attached
 * merely because it was retrieved.
 */
export function mapValidatedCitations(response: string, sources: Source[]): { citations: SourceCitation[]; claimCitations: ClaimCitation[] } {
  const byId = new Map(sources.map((source) => [source.id, source]))
  const citations: SourceCitation[] = []
  const claimCitations: ClaimCitation[] = []
  const seen = new Set<string>()
  let claimIndex = 0
  const add = (id: string, marker: string) => {
    const source = byId.get(id)
    if (!source || seen.has(id)) return
    seen.add(id)
    citations.push(toSourceCitation(source))
    claimCitations.push({ claimIndex: claimIndex++, sourceId: id, marker })
  }
  for (const match of response.matchAll(/_\(src:\s*([a-zA-Z0-9_-]+)\)_|\[Source\s+(\d+)\]/g)) {
    if (match[1]) add(match[1], match[0])
    else add(sources[Number(match[2]) - 1]?.id ?? '', match[0])
  }
  return { citations, claimCitations }
}

function toSourceCitation(s: Source): SourceCitation {
  return { id: s.id, title: s.title ?? ((s.normalizedText ?? s.rawText ?? '').substring(0, 100) || 'Untitled source'), platform: s.platform, postUrl: s.postUrl, publishedAt: s.publishedAt, festivalYear: s.festivalYear, status: s.status, supersedesSourceId: s.supersedesSourceId }
}

const PLATFORMS = new Set(['facebook', 'instagram', 'website', 'pdf', 'news', 'official'])
const SOURCE_STATUSES = new Set(['active', 'updated', 'superseded', 'cancelled', 'postponed', 'archived'])
const LANGUAGES = new Set<ChatLanguage>(['en', 'ceb', 'fil'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(new Date(value).getTime())
}

function validYear(value: unknown): value is FestivalYear {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2020 && value <= 2100
}

function dateFrom(value: unknown, fallback = Date.now()): Date {
  return typeof value === 'string' || typeof value === 'number' ? new Date(value) : new Date(fallback)
}

function isClaimCitation(value: unknown): value is ClaimCitation {
  return isRecord(value) && typeof value.claimIndex === 'number' && Number.isInteger(value.claimIndex) && value.claimIndex >= 0 &&
    typeof value.sourceId === 'string' && typeof value.marker === 'string'
}

function normalizeSourceCitation(value: unknown): SourceCitation | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.title !== 'string' ||
    !PLATFORMS.has(value.platform as string) || !SOURCE_STATUSES.has(value.status as string)) return null
  const publishedAt = value.published_at ?? value.publishedAt
  if (publishedAt !== null && publishedAt !== undefined && !validIsoTimestamp(publishedAt)) return null
  const festivalYear = value.festival_year ?? value.festivalYear
  if (festivalYear !== null && festivalYear !== undefined && !validYear(festivalYear)) return null
  return {
    id: value.id,
    postId: typeof (value.post_id ?? value.postId) === 'string' ? (value.post_id ?? value.postId) as string : undefined,
    title: value.title.trim() || 'Untitled source',
    platform: value.platform as SourceCitation['platform'],
    postUrl: typeof (value.post_url ?? value.postUrl) === 'string' ? (value.post_url ?? value.postUrl) as string : '',
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    festivalYear: festivalYear ?? null,
    status: value.status as SourceCitation['status'],
    supersedesSourceId: typeof (value.supersedes_source_id ?? value.supersedesSourceId) === 'string' ? (value.supersedes_source_id ?? value.supersedesSourceId) as string : undefined,
  }
}

/**
 * Lightweight chunk summary exposed to the client. The full chunk object
 * stays server-side; this is just enough for the UI to show a "matched
 * against N semantic chunks" indicator.
 */
export interface ChunkSummary {
  chunkId: string
  sourceId: string
  content: string
  similarity: number
  sourceStatus: string
  sourceFestivalYear: FestivalYear
}

class ChatService {
  private config: ChatServiceConfig
  private demoMode: boolean

  constructor(config: ChatServiceConfig = {}) {
    this.config = config
    // A caller cannot re-enable fixtures in a production bundle.
    this.demoMode = DEMO_MODE && (config.demoMode ?? true)
  }

  async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    // Year resolution: explicit year in query wins, else current festival year.
    const resolved = resolveFestivalYear(request.message, request.festivalYear)
    const festivalYear = resolved.festivalYear

    // Test/demo fixtures intentionally run without a network navigator; offline
    // product routing applies only to the live production client.
    if (!DEMO_MODE && typeof navigator !== 'undefined' && navigator.onLine === false) return await answerOffline(request, festivalYear)

    if (DEMO_MODE && this.demoMode) {
      return this.sendMessageDemo(request, festivalYear)
    }

    const response = await this.sendMessageLive(request)
    void saveVerifiedKnowledge(response)
    return response
  }

  // ===========================================================================
  // Demo mode
  // ===========================================================================

  private async sendMessageDemo(request: ChatRequest, festivalYear: FestivalYear): Promise<ChatResponse> {
    if (!loadDemoRuntime) throw new ChatConfigurationError('Demo responses are unavailable in this build.')
    const language = resolveChatLanguage(request.message, request.language ?? 'en')
    const { sendDemoMessage } = await loadDemoRuntime()
    return sendDemoMessage(request, festivalYear, language, (content, sources) => {
      const { citations, claimCitations } = mapValidatedCitations(content, sources)
      return { sources: citations, claimCitations }
    })
  }

  // ===========================================================================
  // Live mode (unchanged from Phase 4)
  // ===========================================================================

  private async sendMessageLive(request: ChatRequest): Promise<ChatResponse> {
    const url = resolveChatEndpoint(this.config)
    const publishableKey = this.config.supabasePublishableKey ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.SUPABASE_PUBLISHABLE_KEY
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    request.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeoutMs = this.config.requestTimeoutMs ?? CHAT_REQUEST_TIMEOUT_MS
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(publishableKey && { apikey: publishableKey }),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
    } catch (error) {
      if (request.signal?.aborted) throw new ChatRequestAbortedError()
      if (controller.signal.aborted) throw new ChatTimeoutError(timeoutMs)
      throw error
    } finally {
      globalThis.clearTimeout(timeout)
      request.signal?.removeEventListener('abort', abortFromCaller)
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    const data: unknown = await response.json().catch(() => {
      throw new ChatResponseValidationError('The chat service returned invalid JSON.')
    })
    return this.validateLiveResponse(data)
  }

  private validateLiveResponse(data: unknown): ChatResponse {
    if (!isRecord(data) || !isRecord(data.message) || !Array.isArray(data.retrievedSources) || !Array.isArray(data.retrievedEvents) ||
      !validYear(data.yearResolved) || !LANGUAGES.has(data.language as ChatLanguage)) {
      throw new ChatResponseValidationError()
    }
    const message = data.message
    if (typeof message.id !== 'string' || !message.id.trim() || message.role !== 'assistant' ||
      typeof message.content !== 'string' || !message.content.trim() || !validIsoTimestamp(message.timestamp) || !validYear(message.festivalYear)) {
      throw new ChatResponseValidationError()
    }

    const sources = Array.isArray(message.sources)
      ? message.sources.map(normalizeSourceCitation).filter((source): source is SourceCitation => source !== null)
      : []
    const claimCitations = Array.isArray(message.claimCitations)
      ? message.claimCitations.filter(isClaimCitation)
      : undefined

    return {
      message: { id: message.id, role: 'assistant', content: message.content.trim(), timestamp: message.timestamp, sources, festivalYear: message.festivalYear, ...(claimCitations && { claimCitations }) },
      retrievedSources: data.retrievedSources.filter(isRecord).map((source) => this.hydrateSource(source)),
      retrievedEvents: data.retrievedEvents.filter(isRecord).map((event) => this.hydrateEvent(event)),
      yearResolved: data.yearResolved,
      language: data.language as ChatLanguage,
    }
  }

  private hydrateSource(s: Record<string, unknown>): Source {
    return {
      ...s,
      publishedAt: (s.published_at ?? s.publishedAt) ? dateFrom(s.published_at ?? s.publishedAt) : null,
      ingestedAt: dateFrom(s.ingested_at ?? s.ingestedAt),
      updatedAt: dateFrom(s.updated_at ?? s.updatedAt),
    } as Source
  }

  private hydrateEvent(e: Record<string, unknown>): Event {
    return {
      ...e,
      startDatetime: dateFrom(e.start_datetime ?? e.startDatetime),
      endDatetime: dateFrom(e.end_datetime ?? e.endDatetime),
      deadline: e.deadline ? dateFrom(e.deadline) : undefined,
      createdAt: dateFrom(e.created_at ?? e.createdAt),
      updatedAt: dateFrom(e.updated_at ?? e.updatedAt),
    } as Event
  }

  // ===========================================================================
  // Public helpers
  // ===========================================================================

  async getAvailableYears(): Promise<FestivalYear[]> {
    return []
  }

  getCurrentFestivalYear(): FestivalYear {
    return getCurrentFestivalYear()
  }

  resolveFestivalYear(query: string, defaultYear?: FestivalYear) {
    return resolveFestivalYear(query, defaultYear)
  }

  setDemoMode(enabled: boolean): void {
    this.demoMode = DEMO_MODE && enabled
  }

  isDemoMode(): boolean {
    return this.demoMode
  }
}

export const chatService = new ChatService()
export { ChatService }
