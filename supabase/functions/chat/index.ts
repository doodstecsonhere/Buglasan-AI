/**
 * Buglasan AI - Supabase Edge Function: Chat Endpoint
 * Secure server-side chat with Gemini API, hybrid retrieval, and supersession-aware grounding.
 *
 * Phase 4 Architecture:
 *  - Query-Relevant Hybrid Retrieval:
 *      1. Resolve festival year (Phase 3)         → resolveFestivalYear()
 *      2. Resolve temporal expressions (Phase 3)   → resolveTemporalExpression()
 *      3. Semantic search over source_chunks      → search_source_chunks RPC
 *      4. Structured event retrieval              → get_festival_events RPC
 *      5. Join semantic matches to source records → deduplicate by source_id
 *      6. Restrict evidence to resolved year      → enforced by RPC
 *      7. Exclude superseded/archived evidence    → enforced by RPC
 *      8. Rank + limit context                    → bounded by max limits
 *      9. Optional supersession chain             → get_supersession_chain RPC
 *  - No silent historical fallback. If `includeHistorical` is true (e.g. explicit
 *    "2024 schedule"), the RPCs are called with that historical year instead.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0'
import {
  buildZeroEvidenceFallback,
  shouldUseZeroEvidenceFallback,
  type SupportedLanguage,
} from './grounding.ts'
import { generateQueryEmbedding } from '../_shared/embedding.ts'

// ============================================
// Types
// ============================================
interface ChatRequest {
  message: string
  festivalYear?: number
  language?: SupportedLanguage
  conversationHistory?: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: string
    sources?: SourceCitation[]
  }>
}

interface SourceCitation {
  id: string
  postId: string
  title: string
  platform: string
  postUrl: string
  publishedAt: string
  festivalYear: number
  isCurrent: boolean
  status: string
  supersedesSourceId?: string
}

interface Source {
  id: string
  platform: string
  post_id: string
  post_url: string
  published_at: string | null
  festival_year: number | null
  raw_text: string | null
  normalized_text: string | null
  is_current: boolean
  status: string
  supersedes_source_id?: string
  ingested_at: string
  updated_at: string
}

interface Event {
  id: string
  event_name: string
  aliases: string[]
  description: string
  category: string
  start_datetime: string
  end_datetime: string
  venue: string
  organizer: string
  deadline?: string
  eligibility?: string
  fees?: string
  contact_info?: string
  status: string
  is_current: boolean
  festival_year: number
  created_at: string
  updated_at: string
}

interface ChunkResult {
  chunk_id: string
  source_id: string
  chunk_index: number
  content: string
  similarity: number
  source_platform: string
  source_post_id: string
  source_post_url: string
  source_published_at: string | null
  source_festival_year: number | null
  source_status: string
  source_supersedes_source_id?: string
}

interface SupersessionChainNode {
  source_id: string
  platform: string
  post_id: string
  published_at: string | null
  festival_year: number | null
  status: string
  supersedes_source_id?: string
  level: number
}

interface EvidencePacket {
  sources: Source[]
  events: Event[]
  chunks: ChunkResult[]
  supersessionChains: Record<string, SupersessionChainNode[]>
  queryEmbeddingUsed: boolean
  retrievalStats: {
    chunksFound: number
    eventsFound: number
    sourcesAfterDedup: number
    chainsExpanded: number
  }
}

interface ChatResponse {
  message: {
    id: string
    role: 'assistant'
    content: string
    timestamp: string
    sources: SourceCitation[]
    festivalYear: number
  }
  retrievedSources: Source[]
  retrievedEvents: Event[]
  retrievedChunks: ChunkResult[]
  yearResolved: number
  language: SupportedLanguage
}

// ============================================
// Configuration
// ============================================
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-1.5-flash'
// Default embedding model. Override with the GEMINI_EMBEDDING_MODEL env var.
// gemini-embedding-001 is the current production-recommended Gemini text-only
// embedding model. Vectors are requested with outputDimensionality=768 and
// L2-normalized at write time / before RPC calls — see normalizeEmbedding().
const GEMINI_EMBEDDING_MODEL = Deno.env.get('GEMINI_EMBEDDING_MODEL') || 'gemini-embedding-001'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)
const secretKey = secretKeys['default']

const PH_TIMEZONE = 'Asia/Manila'

// Context-size caps. These bound what we send to Gemini so we never blow
// past the model context window or drown the prompt with low-signal results.
const CONTEXT_LIMITS = {
  maxSources: 8,
  maxEvents: 10,
  maxChunks: 15,
  chunkMatchThreshold: 0.7,
  chunkMatchCount: 20, // fetch a few more than we display so we can dedupe
  eventMatchCount: 25,
  // If the top similarity falls below this, the query is likely off-topic
  // and we should not pad the prompt with low-quality chunks.
  minUsefulSimilarity: 0.7,
}

// ============================================
// System Prompt
// ============================================
const SYSTEM_PROMPT = `You are Buglasan AI, a multilingual, year-aware AI companion for the Buglasan Festival of Negros Oriental, Philippines.

CORE PRINCIPLES:
1. GROUNDING: Only answer using provided sources and events. Never hallucinate.
2. CITATIONS: Always cite sources inline using [Source N] format.
3. YEAR-AWARENESS: Respect the festival_year context. Current year takes priority.
4. SUPERSESSION: Prefer non-superseded, current sources. Note when info was updated.
5. HONESTY: If no current official info exists, say so clearly. Historical info only if explicitly labeled.
6. MULTILINGUAL: Respond in the user's language (English, Cebuano/Bisaya, Filipino/Tagalog).
7. DATE REASONING: Resolve "today", "tomorrow", "this weekend", "upcoming" in Asia/Manila timezone.

RESPONSE FORMAT:
- Use clear, conversational tone with festival warmth
- Structure with headers, bullets, emojis for readability
- Inline citations: [Source 1], [Source 2]
- End with "Sources:" section listing all cited sources
- If uncertain: "Based on available official sources..." or "No current official information found for..."

LANGUAGES:
- English: Default
- Cebuano/Bisaya: "Unsaon nimo pagtabang?" / "Festival sa Buglasan"
- Filipino/Tagalog: "Paano kita matutulungan?" / "Festival ng Buglasan"

CURRENT CONTEXT:
- Timezone: Asia/Manila
- The resolved festival year and current official evidence are provided in context
- Do not rely on prior knowledge for festival dates, venues, schedules, organizers, traditions, history, or announcement timing`

// ============================================
// Year & Temporal Resolution
// ============================================
function getCurrentFestivalYear(): number {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: PH_TIMEZONE }))
  return now.getFullYear()
}

function resolveFestivalYear(query: string, defaultYear: number): { year: number; isExplicit: boolean } {
  const yearPatterns = [
    /\b(20\d{2})\b/g,
    /\b(year\s+20\d{2})\b/gi,
    /\b(festival\s+20\d{2})\b/gi,
    /\b(buglasan\s+20\d{2})\b/gi,
  ]

  for (const pattern of yearPatterns) {
    const matches = query.match(pattern)
    if (matches) {
      const yearMatch = matches[0].match(/\d{4}/)
      if (yearMatch) {
        const explicitYear = parseInt(yearMatch[0], 10)
        if (explicitYear >= 2020 && explicitYear <= 2030) {
          return { year: explicitYear, isExplicit: true }
        }
      }
    }
  }

  const relativePatterns = [
    { pattern: /\b(last|previous|past)\s+year\b/i, offset: -1 },
    { pattern: /\b(next|upcoming|coming)\s+year\b/i, offset: 1 },
    { pattern: /\b(this|current)\s+year\b/i, offset: 0 },
  ]

  for (const { pattern, offset } of relativePatterns) {
    if (pattern.test(query)) {
      return { year: defaultYear + offset, isExplicit: true }
    }
  }

  return { year: defaultYear, isExplicit: false }
}

/**
 * Resolve temporal expressions in user query to date range.
 * Handles: "today", "tomorrow", "this weekend", "this week", "next week",
 * "October 18", "Oct 18", "18 October", "upcoming", "coming soon".
 * Returns { startDate, endDate, isRelative } in Asia/Manila timezone.
 */
function resolveTemporalExpression(query: string, currentDate: Date): { startDate?: Date; endDate?: Date; isRelative: boolean } {
  const lowerQuery = query.toLowerCase().trim()
  const refDate = new Date(currentDate)
  refDate.setHours(0, 0, 0, 0)

  const tomorrow = new Date(refDate)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const dayOfWeek = refDate.getDay()
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7
  const thisSaturday = new Date(refDate)
  thisSaturday.setDate(refDate.getDate() + (daysUntilSaturday || 7))
  const thisSunday = new Date(thisSaturday)
  thisSunday.setDate(thisSunday.getDate() + 1)

  const nextSaturday = new Date(thisSaturday)
  nextSaturday.setDate(nextSaturday.getDate() + 7)
  const nextSunday = new Date(nextSaturday)
  nextSunday.setDate(nextSunday.getDate() + 1)

  const nextWeekStart = new Date(refDate)
  nextWeekStart.setDate(refDate.getDate() + 7)
  const nextWeekEnd = new Date(nextWeekStart)
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 6)

  if (/\b(today|now)\b/i.test(lowerQuery)) {
    return { startDate: refDate, endDate: refDate, isRelative: true }
  }

  if (/\b(tomorrow|tmrw)\b/i.test(lowerQuery)) {
    return { startDate: tomorrow, endDate: tomorrow, isRelative: true }
  }

  if (/\b(this\s+weekend|^weekend$)\b/i.test(lowerQuery)) {
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const endDay = dayOfWeek === 0 ? refDate : thisSunday
      return { startDate: refDate, endDate: endDay, isRelative: true }
    }
    return { startDate: thisSaturday, endDate: thisSunday, isRelative: true }
  }

  if (/\b(next\s+weekend)\b/i.test(lowerQuery)) {
    return { startDate: nextSaturday, endDate: nextSunday, isRelative: true }
  }

  if (/\b(this\s+week)\b/i.test(lowerQuery)) {
    const weekEnd = new Date(refDate)
    weekEnd.setDate(refDate.getDate() + 6)
    return { startDate: refDate, endDate: weekEnd, isRelative: true }
  }

  if (/\b(next\s+week)\b/i.test(lowerQuery)) {
    return { startDate: nextWeekStart, endDate: nextWeekEnd, isRelative: true }
  }

  if (/\b(upcoming|coming\s+soon|soon)\b/i.test(lowerQuery)) {
    const endDate = new Date(refDate)
    endDate.setDate(refDate.getDate() + 30)
    return { startDate: refDate, endDate, isRelative: true }
  }

  const datePatterns = [
    { regex: /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s*(\d{4})?/i, type: 'month_day_year' },
    { regex: /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})?/i, type: 'day_month_year' },
    { regex: /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, type: 'mm_dd_yyyy' },
  ]

  for (const { regex, type } of datePatterns) {
    const match = lowerQuery.match(regex)
    if (match) {
      try {
        let parsedDate: Date
        const monthMap: Record<string, number> = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
          jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        }
        if (type === 'month_day_year') {
          const monthStr = match[1].toLowerCase()
          const day = parseInt(match[2], 10)
          const year = match[3] ? parseInt(match[3], 10) : refDate.getFullYear()
          parsedDate = new Date(year, monthMap[monthStr.substring(0, 3)], day)
        } else if (type === 'day_month_year') {
          const day = parseInt(match[1], 10)
          const monthStr = match[2].toLowerCase()
          const year = match[3] ? parseInt(match[3], 10) : refDate.getFullYear()
          parsedDate = new Date(year, monthMap[monthStr.substring(0, 3)], day)
        } else {
          const month = parseInt(match[1], 10) - 1
          const day = parseInt(match[2], 10)
          let year = parseInt(match[3], 10)
          if (year < 100) year += 2000
          parsedDate = new Date(year, month, day)
        }

        if (!isNaN(parsedDate.getTime())) {
          parsedDate.setHours(0, 0, 0, 0)
          return { startDate: parsedDate, endDate: parsedDate, isRelative: false }
        }
      } catch {
        // Ignore parse errors, continue to next pattern
      }
    }
  }

  return { isRelative: false }
}

// ============================================
// Embedding Generation
// ============================================

/**
 * Truncate an embedding vector to `dimension` if it is longer, then apply
 * L2 normalization (unit vector).
 *
 * Why this is needed for gemini-embedding-001:
 *   - The model is configured with `outputDimensionality: 768`, which asks
 *     Gemini to truncate its native 3072-dim vector to 768 dims for cheaper
 *     storage / faster similarity. According to Google's current Gemini
 *     embedding documentation, vectors truncated this way MUST be L2-normalized
 *     by the caller before being used for cosine similarity.
 *   - Our RPC (`search_source_chunks`) uses pgvector's `<=>` cosine distance
 *     operator. For unit-length vectors, cosine distance == 1 - cosine similarity,
 *     so it returns the expected 0..1 similarity score. With unnormalized
 *     vectors, scores are biased by magnitude and ranking breaks down.
 *
 * This helper is shared with document embeddings written by n8n — the same
 * normalizeEmbedding() must run there so stored vectors are also unit length.
 */
/**
 * Generate a 768-dimensional query embedding using Gemini's gemini-embedding-001
 * (default, override via GEMINI_EMBEDDING_MODEL).
 *
 * The function:
 *   1. Calls the Gemini Embedding API with `outputDimensionality: 768`
 *      and `taskType: RETRIEVAL_QUERY`.
 *   2. Truncates to 768 dims if Gemini ever returns a longer vector.
 *   3. L2-normalizes the result (required for cosine similarity use of
 *      truncated gemini-embedding-001 vectors).
 *
 * Modular: the call site only depends on the return value (number[]), so the
 * provider can be swapped (e.g. OpenAI, Cohere, Vertex) without changing
 * downstream retrieval logic — as long as the new provider's vectors are
 * also normalized to unit length before storage/comparison.
 */

// ============================================
// Hybrid Retrieval: retrieveEvidence
// ============================================

interface RetrieveEvidenceOptions {
  limit?: number
  includeSuperseded?: boolean
  categoryFilter?: string[]
  includeHistorical?: boolean
  // For explicit correction questions: walk the supersession chain
  resolveSupersessionChains?: boolean
}

/**
 * Phase 4 hybrid retrieval:
 *   1. Generate query embedding (Gemini gemini-embedding-001, 768 dims,
 *      L2-normalized; see generateQueryEmbedding / normalizeEmbedding)
 *   2. Semantic search over source_chunks via search_source_chunks RPC
 *   3. Structured event retrieval via get_festival_events RPC
 *   4. Join chunks back to source records, dedupe
 *   5. Optionally walk supersession chains for correction queries
 *
 * All evidence is restricted to the resolved festival year by the RPCs.
 * Superseded/archived sources are excluded from primary results unless
 * `includeSuperseded` is explicitly true.
 *
 * NOTE: We deliberately do NOT fall back to other years. If the user wants
 * historical info they must request it (e.g. "2024 schedule") — in that case
 * the resolver returns isExplicit=true with the historical year, and we run
 * the same retrieval against that year.
 */
async function retrieveEvidence(
  supabase: any,
  festivalYear: number,
  query: string,
  temporalFilter?: { startDate?: Date; endDate?: Date },
  options: RetrieveEvidenceOptions = {}
): Promise<EvidencePacket> {
  const limits = {
    maxSources: options.limit ?? CONTEXT_LIMITS.maxSources,
    maxChunks: CONTEXT_LIMITS.maxChunks,
    chunkMatchCount: CONTEXT_LIMITS.chunkMatchCount,
    eventMatchCount: CONTEXT_LIMITS.eventMatchCount,
  }

  const empty: EvidencePacket = {
    sources: [],
    events: [],
    chunks: [],
    supersessionChains: {},
    queryEmbeddingUsed: false,
    retrievalStats: { chunksFound: 0, eventsFound: 0, sourcesAfterDedup: 0, chainsExpanded: 0 },
  }

  // Step 1: Embed the query
  let embedding: number[] | null = null
  try {
    embedding = await generateQueryEmbedding(query, { apiKey: GEMINI_API_KEY, model: GEMINI_EMBEDDING_MODEL })
  } catch (err) {
    console.error('Query embedding failed, falling back to event-only retrieval:', err)
    // We can still return events without semantic source chunks.
  }

  // Step 2 + 3: Fire RPCs in parallel
  const tasks: Array<Promise<any>> = []

  if (embedding) {
    tasks.push(
      supabase.rpc('search_source_chunks', {
        query_embedding: embedding,
        target_festival_year: festivalYear,
        match_threshold: CONTEXT_LIMITS.chunkMatchThreshold,
        match_count: limits.chunkMatchCount,
      })
    )
  } else {
    tasks.push(Promise.resolve({ data: [], error: null }))
  }

  tasks.push(
    supabase.rpc('get_festival_events', {
      target_festival_year: festivalYear,
      start_date: temporalFilter?.startDate?.toISOString() ?? null,
      end_date: temporalFilter?.endDate?.toISOString() ?? null,
      category_filter: options.categoryFilter ?? null,
      // Canonical lifecycle corrections are retrieval evidence too: a cancelled
      // or postponed event must be visible so the assistant does not present a
      // stale schedule. Exact festival-year filtering remains in the RPC.
      status_filter: ['scheduled', 'confirmed', 'postponed', 'cancelled'],
    })
  )

  const [chunksRes, eventsRes] = await Promise.all(tasks)

  if (chunksRes?.error) {
    console.error('search_source_chunks RPC error:', chunksRes.error)
  }
  if (eventsRes?.error) {
    console.error('get_festival_events RPC error:', eventsRes.error)
  }

  const rawChunks: ChunkResult[] = (chunksRes?.data ?? []) as ChunkResult[]
  const rawEvents: Event[] = (eventsRes?.data ?? []) as Event[]

  // Step 4: Drop low-similarity chunks and dedupe by source_id,
  // keeping the highest-similarity chunk per source.
  const usefulChunks = rawChunks.filter(
    (c) => c.similarity >= CONTEXT_LIMITS.minUsefulSimilarity
  )
  const bestBySource = new Map<string, ChunkResult>()
  for (const c of usefulChunks) {
    const prev = bestBySource.get(c.source_id)
    if (!prev || c.similarity > prev.similarity) {
      bestBySource.set(c.source_id, c)
    }
  }
  const rankedChunks = usefulChunks
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limits.maxChunks)

  // Build Source records from chunk metadata. The RPC includes official source
  // identity so semantic citations remain attributable and linkable.
  // For text fields, the chunk content is the best signal we have on hand
  // without an extra round-trip; we tag them as "via-chunk" for transparency.
  const sourceById = new Map<string, Source>()
  for (const c of usefulChunks) {
    if (sourceById.has(c.source_id)) continue
    sourceById.set(c.source_id, {
      id: c.source_id,
      platform: c.source_platform,
      post_id: c.source_post_id,
      post_url: c.source_post_url,
      published_at: c.source_published_at,
      festival_year: c.source_festival_year,
      raw_text: c.content,
      normalized_text: c.content,
      is_current: ['active', 'updated', 'postponed'].includes(c.source_status),
      status: c.source_status,
      supersedes_source_id: c.source_supersedes_source_id ?? undefined,
      ingested_at: '',
      updated_at: '',
    })
  }
  let sources = Array.from(sourceById.values()).slice(0, limits.maxSources)

  // Step 5: Optionally walk supersession chains. We only do this when the
  // user is asking an explicit correction/lineage question, to avoid extra
  // round-trips on every query.
  const supersessionChains: Record<string, SupersessionChainNode[]> = {}
  let chainsExpanded = 0
  if (options.resolveSupersessionChains) {
    for (const s of sources) {
      if (!s.supersedes_source_id) continue
      try {
        const { data: chain, error } = await supabase.rpc('get_supersession_chain', {
          source_id: s.id,
        })
        if (!error && Array.isArray(chain) && chain.length > 0) {
          supersessionChains[s.id] = chain as SupersessionChainNode[]
          chainsExpanded++
        }
      } catch (err) {
        console.warn('get_supersession_chain failed for', s.id, err)
      }
    }
  }

  // Truncate events
  const events = rawEvents.slice(0, CONTEXT_LIMITS.maxEvents)

  return {
    sources,
    events,
    chunks: rankedChunks,
    supersessionChains,
    queryEmbeddingUsed: embedding !== null,
    retrievalStats: {
      chunksFound: usefulChunks.length,
      eventsFound: rawEvents.length,
      sourcesAfterDedup: sourceById.size,
      chainsExpanded,
    },
  }
}

function classifyChatError(error: unknown): { category: string; code: string } {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (lower.includes('rpc') || lower.includes('function public.') || lower.includes('does not exist')) return { category: 'rpc_contract_error', code: 'retrieval_rpc_failed' }
  if (!GEMINI_API_KEY || lower.includes('api key') || lower.includes('unauthorized') || lower.includes('permission')) return { category: 'provider_configuration_error', code: 'provider_credentials' }
  if (lower.includes('429') || /\b(500|502|503|504)\b/.test(lower) || lower.includes('timeout') || lower.includes('fetch failed')) return { category: 'provider_unavailable', code: 'provider_transport' }
  if (lower.includes('generatecontent') || lower.includes('model')) return { category: 'provider_error', code: 'generation_request' }
  return { category: 'internal_error', code: 'unclassified_runtime_error' }
}

// ============================================
// Prompt Formatting
// ============================================
function formatSourcesForPrompt(sources: Source[]): string {
  if (sources.length === 0) return 'No sources matched the query for the resolved festival year.'

  return sources.map((s, i) => {
    const date = s.published_at
      ? new Date(s.published_at).toLocaleDateString('en-PH', {
          timeZone: PH_TIMEZONE, month: 'short', day: 'numeric', year: 'numeric',
        })
      : 'n/a'
    const statusTag =
      s.status === 'active' ? '✅ Current' :
      s.status === 'updated' ? '🔄 Updated (supersedes previous)' :
      s.status === 'postponed' ? '⏸️ Postponement notice' :
      s.status === 'superseded' ? '↩️ Superseded' :
      s.status === 'cancelled' ? '❌ Cancelled' :
      '📦 Archived'
    const supersedes = s.supersedes_source_id
      ? ` (supersedes source ${s.supersedes_source_id.substring(0, 8)}…)`
      : ''

    const text = s.normalized_text ?? s.raw_text ?? '[Non-text source; no extracted text available]'
    return `[Source ${i + 1}] ${s.platform.toUpperCase()} | ${date} | FY${s.festival_year ?? 'unknown'} | ${statusTag}${supersedes}\n${text.substring(0, 600)}${text.length > 600 ? '…' : ''}`
  }).join('\n\n')
}

function formatChunksForPrompt(chunks: ChunkResult[]): string {
  if (chunks.length === 0) return ''
  const lines = chunks.map((c, i) => {
    const sim = (c.similarity * 100).toFixed(1)
    return `[Chunk ${i + 1}] similarity=${sim}% | source=${c.source_id.substring(0, 8)}… | status=${c.source_status}\n${c.content.substring(0, 500)}${c.content.length > 500 ? '…' : ''}`
  })
  return `=== SEMANTIC CHUNKS (most relevant first) ===\n${lines.join('\n\n')}`
}

function formatSupersessionChainsForPrompt(chains: Record<string, SupersessionChainNode[]>): string {
  const entries = Object.entries(chains)
  if (entries.length === 0) return ''
  const lines = entries.map(([headId, chain]) => {
    const sortedChain = [...chain].sort((a, b) => a.level - b.level)
    const rows = sortedChain.map((n) => {
      const date = new Date(n.published_at).toLocaleDateString('en-PH', {
        timeZone: PH_TIMEZONE, month: 'short', day: 'numeric', year: 'numeric',
      })
      return `  L${n.level} ${n.status} | ${n.platform} | ${date} | FY${n.festival_year}`
    })
    return `Chain for ${headId.substring(0, 8)}… (oldest → newest):\n${rows.join('\n')}`
  })
  return `=== SUPERSESSION LINEAGE (for context, do not invent details) ===\n${lines.join('\n\n')}`
}

function formatEventsForPrompt(events: Event[]): string {
  if (events.length === 0) return 'No events matched the query for the resolved festival year.'

  return events.map((e, i) => {
    const start = new Date(e.start_datetime).toLocaleString('en-PH', {
      timeZone: PH_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
    const end = new Date(e.end_datetime).toLocaleString('en-PH', {
      timeZone: PH_TIMEZONE, hour: 'numeric', minute: '2-digit',
    })
    return `[Event ${i + 1}] ${e.event_name} (${e.category})\nDate: ${start} - ${end}\nVenue: ${e.venue}\nStatus: ${e.status}\nDescription: ${e.description}\n${e.deadline ? `Deadline: ${new Date(e.deadline).toLocaleDateString('en-PH', { timeZone: PH_TIMEZONE })}` : ''}${e.eligibility ? `\nEligibility: ${e.eligibility}` : ''}${e.fees ? `\nFees: ${e.fees}` : ''}${e.contact_info ? `\nContact: ${e.contact_info}` : ''}`
  }).join('\n\n')
}

function extractCitations(response: string, sources: Source[]): SourceCitation[] {
  const citations: SourceCitation[] = []
  const sourceRefs = response.match(/\[Source (\d+)\]/g)
  if (!sourceRefs) return citations

  const usedIndices = new Set(
    sourceRefs.map((r) => parseInt(r.match(/\d+/)?.[0] || '0', 10) - 1)
  )

  for (const idx of usedIndices) {
    if (idx >= 0 && idx < sources.length) {
      const s = sources[idx]
      citations.push({
        id: s.id,
        postId: s.post_id,
        title: s.normalized_text.substring(0, 100),
        platform: s.platform,
        postUrl: s.post_url,
        publishedAt: s.published_at,
        festivalYear: s.festival_year,
        isCurrent: s.is_current,
        status: s.status,
        supersedesSourceId: s.supersedes_source_id,
      })
    }
  }
  return citations
}

function detectCorrectionQuery(query: string): boolean {
  return /\b(was\s+(?:this|it|that)\s+(?:changed|updated|corrected)|superseded|previous\s+(?:version|announcement)|what\s+changed|correction|updated\s+(?:from|version))\b/i.test(
    query
  )
}

// ============================================
// Main Handler
// ============================================
serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body: ChatRequest = await req.json()
    const { message, festivalYear, language = 'en', conversationHistory = [] } = body

    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, secretKey)
    // ---- Year resolution (Phase 3) ----
    const defaultYear = festivalYear || getCurrentFestivalYear()
    const { year: resolvedYear, isExplicit } = resolveFestivalYear(message, defaultYear)

    // ---- Temporal expression resolution (Phase 3) ----
    const currentDateObj = new Date(
      new Date().toLocaleString('en-US', { timeZone: PH_TIMEZONE })
    )
    const currentDate = currentDateObj.toLocaleString('en-PH', { timeZone: PH_TIMEZONE })
    const temporalResult = resolveTemporalExpression(message, currentDateObj)
    const hasTemporalFilter = temporalResult.startDate !== undefined

    const lowerMessage = message.toLowerCase()
    const isRegistrationQuery =
      /\b(register|registration|sign\s*up|join|participate|deadline)\b/i.test(lowerMessage) &&
      /\b(still|can|open|available|upcoming)\b/i.test(lowerMessage)
    const isUpcomingQuery =
      /\b(upcoming|coming|soon|next|this\s+week|this\s+weekend)\b/i.test(lowerMessage) &&
      /\b(event|activity|schedule|happening)\b/i.test(lowerMessage)
    const isCorrectionQuery = detectCorrectionQuery(message)

    // For explicit historical years (e.g. "2024 schedule"), opt into historical
    // retrieval. Otherwise, the resolved year is the source of truth and we
    // never silently fall back to other years.
    const isHistoricalRequest = isExplicit && resolvedYear !== getCurrentFestivalYear()

    // ---- Hybrid retrieval (Phase 4) ----
    const evidence = await retrieveEvidence(
      supabase,
      resolvedYear,
      message,
      { startDate: temporalResult.startDate, endDate: temporalResult.endDate },
      {
        includeHistorical: isHistoricalRequest,
        resolveSupersessionChains: isCorrectionQuery,
      }
    )

    // Factual festival questions must never reach the generative model when
    // retrieval produced no usable official evidence. General conversation
    // remains model-handled even without evidence.
    if (shouldUseZeroEvidenceFallback(message, evidence)) {
      const response: ChatResponse = {
        message: {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: buildZeroEvidenceFallback(resolvedYear, language),
          timestamp: new Date().toISOString(),
          sources: [],
          festivalYear: resolvedYear,
        },
        retrievedSources: [],
        retrievedEvents: [],
        retrievedChunks: [],
        yearResolved: resolvedYear,
        language,
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })

    // Build context sections
    const sourcesContext = formatSourcesForPrompt(evidence.sources)
    const chunksContext = formatChunksForPrompt(evidence.chunks)
    const eventsContext = formatEventsForPrompt(evidence.events)
    const chainContext = formatSupersessionChainsForPrompt(evidence.supersessionChains)

    // Temporal filter annotation
    let temporalContext = ''
    if (hasTemporalFilter) {
      const startStr = temporalResult.startDate!.toLocaleDateString('en-PH', {
        timeZone: PH_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric',
      })
      const endStr = temporalResult.endDate!.toLocaleDateString('en-PH', {
        timeZone: PH_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric',
      })
      temporalContext = temporalResult.startDate!.getTime() === temporalResult.endDate!.getTime()
        ? `\nTEMPORAL FILTER APPLIED: Events filtered for ${startStr} (from query: "${temporalResult.isRelative ? 'relative expression' : 'specific date'}")`
        : `\nTEMPORAL FILTER APPLIED: Events filtered for ${startStr} to ${endStr} (from query: "${temporalResult.isRelative ? 'relative expression' : 'specific date'}")`
    } else if (isRegistrationQuery) {
      temporalContext = '\nTEMPORAL FILTER APPLIED: Events filtered for open registration deadlines (deadline >= today, status: scheduled/confirmed)'
    } else if (isUpcomingQuery) {
      temporalContext = '\nTEMPORAL FILTER APPLIED: Events filtered for upcoming events (start_datetime >= today, status: scheduled/confirmed)'
    }

    const historyContext = conversationHistory
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n')

    const retrievalSummary = `RETRIEVAL STATS: ${evidence.retrievalStats.chunksFound} matching chunks (showing ${evidence.chunks.length}), ${evidence.retrievalStats.sourcesAfterDedup} unique sources (capped at ${CONTEXT_LIMITS.maxSources}), ${evidence.retrievalStats.eventsFound} events (showing ${evidence.events.length}), embedding=${evidence.queryEmbeddingUsed ? 'used' : 'FAILED'}.`

    const prompt = `${SYSTEM_PROMPT}

CURRENT DATE (Asia/Manila): ${currentDate}
RESOLVED FESTIVAL YEAR: ${resolvedYear} ${isExplicit ? '(explicitly requested)' : '(default)'}
${retrievalSummary}
${temporalContext}

=== AVAILABLE SOURCES (${resolvedYear}, current only) ===
${sourcesContext}

${chunksContext}

=== FESTIVAL EVENTS (${resolvedYear}) ===
${eventsContext}

${chainContext}

=== CONVERSATION HISTORY ===
${historyContext || 'No previous messages'}

=== USER QUERY ===
${message}

=== INSTRUCTIONS ===
Answer the user's query using ONLY the provided sources and events.
- Cite sources inline as [Source N] (numbers match the AVAILABLE SOURCES list above).
- If the query is about a different year than ${resolvedYear}, clarify you're showing ${resolvedYear} info.
- If no current info exists, state: "No current official information found for ${resolvedYear}."
- Respond in ${language === 'ceb' ? 'Cebuano/Bisaya' : language === 'fil' ? 'Filipino/Tagalog' : 'English'}.
- Be warm, helpful, and festival-appropriate.
${temporalContext ? '- Note: Events have been pre-filtered based on temporal expressions in the query. Reference this filtering in your answer.' : ''}
${isHistoricalRequest ? `- Note: The user explicitly asked for FY${resolvedYear}. If that year has no current data, say so honestly rather than substituting the current year.` : ''}
${isCorrectionQuery ? '- Note: A supersession lineage has been provided. Use it to explain what changed and when, but do not invent details about sources not in the chain.' : ''}
- If a source status is "superseded" or "cancelled" or "archived", do NOT cite it as current — it is included only for lineage context.`

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    const citations = extractCitations(responseText, evidence.sources)

    const response: ChatResponse = {
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        sources: citations,
        festivalYear: resolvedYear,
      },
      retrievedSources: evidence.sources,
      retrievedEvents: evidence.events,
      retrievedChunks: evidence.chunks,
      yearResolved: resolvedYear,
      language,
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const classification = classifyChatError(error)
    const requestId = crypto.randomUUID()
    console.error('Chat function error', { requestId, category: classification.category, code: classification.code })
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        category: classification.category,
        code: classification.code,
        requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
