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

import type { Source, Event, FestivalYear, SourceCitation, Platform } from '../types'
import { resolveFestivalYear, getCurrentFestivalYear, getCurrentDateInPH } from '../utils/dateUtils'
import {
  demoSources,
  demoEvents,
  getCurrentSourcesForYear,
  getCurrentEventsForYear,
  getPrimarySourcesForEvent,
  getVenueSourceForEvent,
  getOrganizerSourceForEvent,
  isDemoFixture,
} from '../data/demoData'

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false'
const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || '/functions/v1/chat'

export interface ChatServiceConfig {
  demoMode?: boolean
  edgeFunctionUrl?: string
  supabaseUrl?: string
  supabasePublishableKey?: string
}

export interface ChatRequest {
  message: string
  festivalYear?: FestivalYear
  language?: 'en' | 'ceb' | 'fil'
  conversationHistory?: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: string
    sources?: SourceCitation[]
  }>
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
  }
  retrievedSources: Source[]
  retrievedEvents: Event[]
  retrievedChunks?: ChunkSummary[]
  yearResolved: FestivalYear
  language: 'en' | 'ceb' | 'fil'
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

// ===========================================================================
// Module-level helpers (single source of truth for parsing demo source text)
// ===========================================================================

/**
 * Strip the [DEMO FIXTURE] marker from a string for display purposes.
 */
function stripDemoMarker(text: string): string {
  return text.replace(/\[DEMO FIXTURE\]\s*/g, '').trim()
}

/**
 * Derive a venue string from a backing source's normalizedText.
 * Falls back to the provided string if the source doesn't contain a venue.
 */
function extractVenueFromSource(source: Source, fallback: string): string {
  if (!source) return fallback
  const text = stripDemoMarker(source.normalizedText ?? source.rawText ?? '')
  const match = text.match(/Venue(?:s)?:\s*([^.\n]+)/i)
  if (match) {
    const raw = match[1].split(/\.\s+Hosts?:/i)[0].trim()
    return raw.replace(/\s*\(.*$/, '').trim() || fallback
  }
  return fallback
}

/**
 * Derive an organizer string from a backing source's normalizedText.
 */
function extractOrganizerFromSource(source: Source, fallback: string): string {
  if (!source) return fallback
  const text = stripDemoMarker(source.normalizedText ?? source.rawText ?? '')
  const match = text.match(/Organizer(?:s)?(?:\s+for[^:]+)?:\s*([^.\n]+)/i)
  if (match) {
    return match[1].trim() || fallback
  }
  return fallback
}

class ChatService {
  private config: ChatServiceConfig
  private demoMode: boolean

  constructor(config: ChatServiceConfig = {}) {
    this.config = config
    this.demoMode = config.demoMode ?? DEMO_MODE
  }

  async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    // Year resolution: explicit year in query wins, else current festival year.
    const resolved = resolveFestivalYear(request.message, request.festivalYear)
    const festivalYear = resolved.festivalYear

    if (this.demoMode) {
      return this.sendMessageDemo(request, festivalYear)
    }

    return this.sendMessageLive(request)
  }

  // ===========================================================================
  // Demo mode
  // ===========================================================================

  private async sendMessageDemo(request: ChatRequest, festivalYear: FestivalYear): Promise<ChatResponse> {
    const { message, language = 'en' } = request

    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 400))

    // Cross-year isolation: only sources for the requested year.
    const yearSources = getCurrentSourcesForYear(festivalYear)
    const yearEvents = getCurrentEventsForYear(festivalYear)

    const responseContent = this.generateDemoResponse(message, festivalYear, yearSources, yearEvents, language)
    const citations = this.extractCitations(responseContent, yearSources)

    return {
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: responseContent,
        timestamp: new Date().toISOString(),
        sources: citations,
        festivalYear,
      },
      retrievedSources: yearSources,
      retrievedEvents: yearEvents,
      retrievedChunks: [],
      yearResolved: festivalYear,
      language,
    }
  }

  /**
   * Build the demo assistant message.
   *
   * All factual claims in the response come from `demoSources` records — never
   * from hard-coded strings inside this function. The function dispatches on
   * query intent and reads from the source-backed data, demonstrating:
   *
   *   1. Year resolution — sources filtered by `festivalYear`
   *   2. Cross-year isolation — superseded/archived sources excluded by default
   *   3. Supersession — superseded sources never returned as primary evidence
   *   4. Temporal filtering — "upcoming" filters by current date
   *   5. Zero evidence — honest "no demo information found" when no source matches
   */
  private generateDemoResponse(
    query: string,
    year: FestivalYear,
    sources: Source[],
    events: Event[],
    language: 'en' | 'ceb' | 'fil'
  ): string {
    const lowerQuery = query.toLowerCase().trim()
    const now = getCurrentDateInPH()

    const t = {
      en: {
        scheduleHeader: (y: FestivalYear) => `📅 **Buglasan Festival ${y}** schedule (derived from demo sources):`,
        venueHeader: (y: FestivalYear) => `📍 **Venues for Buglasan Festival ${y}** (derived from demo sources):`,
        historyHeader: `📜 **About Buglasan** (derived from demo history source):`,
        registrationHeader: (y: FestivalYear) => `📝 **Registration info for ${y}** (derived from demo source):`,
        foodHeader: (y: FestivalYear) => `🍽️ **Buglasan Food Fair ${y}** (derived from demo source):`,
        upcomingHeader: (y: FestivalYear) => `⏭️ **Upcoming events for ${y}** (after ${now.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}):`,
        supersessionHeader: (y: FestivalYear) => `🔄 **Venue / organizer changes for ${y}** (supersession in effect):`,
        noInfo: (y: FestivalYear) => `No demo information found for ${y}. Try asking about schedule, venues, registration, food fair, or history — or switch the festival year.`,
        noMatch: (y: FestivalYear) => `No demo information matches that query for ${y}.`,
        organizerLine: (org: string, src: Source) => `   • Organizer: **${org}** _(src: ${src.id})_`,
        venueLine: (venue: string, src: Source) => `   • Venue: **${venue}** _(src: ${src.id})_`,
        scheduleNote: `*Note: Demo fixtures only. Real ingestion will replace this data.*`,
        suggestion: (y: FestivalYear) => `Try asking about schedule, venues, registration, food fair, or history for ${y}.`,
      },
      ceb: {
        scheduleHeader: (y: FestivalYear) => `📅 **Buglasan Festival ${y}** nga schedule (gikan sa demo sources):`,
        venueHeader: (y: FestivalYear) => `📍 **Mga venue sa Buglasan Festival ${y}** (gikan sa demo sources):`,
        historyHeader: `📜 **Mahitungod sa Buglasan** (gikan sa demo history source):`,
        registrationHeader: (y: FestivalYear) => `📝 **Registration info alang sa ${y}** (gikan sa demo source):`,
        foodHeader: (y: FestivalYear) => `🍽️ **Buglasan Food Fair ${y}** (gikan sa demo source):`,
        upcomingHeader: (y: FestivalYear) => `⏭️ **Sunod nga mga event alang sa ${y}** (human sa ${now.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}):`,
        supersessionHeader: (y: FestivalYear) => `🔄 **Mga pagbag-o sa venue / organizer alang sa ${y}** (supersession):`,
        noInfo: (y: FestivalYear) => `Walay demo nga impormasyon nga nakaplagan alang sa ${y}.`,
        noMatch: (y: FestivalYear) => `Walay demo nga impormasyon nga nagtugma sa pangutana alang sa ${y}.`,
        organizerLine: (org: string, src: Source) => `   • Organizer: **${org}** _(src: ${src.id})_`,
        venueLine: (venue: string, src: Source) => `   • Venue: **${venue}** _(src: ${src.id})_`,
        scheduleNote: `*Matikod: Demo fixtures lamang. Real ingestion mopuli niini.*`,
        suggestion: (y: FestivalYear) => `Pangutan-a ang schedule, mga venue, registration, food fair, o history alang sa ${y}.`,
      },
      fil: {
        scheduleHeader: (y: FestivalYear) => `📅 **Buglasan Festival ${y}** schedule (mula sa demo sources):`,
        venueHeader: (y: FestivalYear) => `📍 **Mga venue para sa Buglasan Festival ${y}** (mula sa demo sources):`,
        historyHeader: `📜 **Tungkol sa Buglasan** (mula sa demo history source):`,
        registrationHeader: (y: FestivalYear) => `📝 **Registration info para sa ${y}** (mula sa demo source):`,
        foodHeader: (y: FestivalYear) => `🍽️ **Buglasan Food Fair ${y}** (mula sa demo source):`,
        upcomingHeader: (y: FestivalYear) => `⏭️ **Paparating na mga event para sa ${y}** (pagkatapos ng ${now.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}):`,
        supersessionHeader: (y: FestivalYear) => `🔄 **Mga pagbabago sa venue / organizer para sa ${y}** (supersession):`,
        noInfo: (y: FestivalYear) => `Walang demo information na nahanap para sa ${y}.`,
        noMatch: (y: FestivalYear) => `Walang demo information na tumutugma sa tanong para sa ${y}.`,
        organizerLine: (org: string, src: Source) => `   • Organizer: **${org}** _(src: ${src.id})_`,
        venueLine: (venue: string, src: Source) => `   • Venue: **${venue}** _(src: ${src.id})_`,
        scheduleNote: `*Tandaan: Demo fixtures lang. Real ingestion papalit nito.*`,
        suggestion: (y: FestivalYear) => `Magtanong tungkol sa schedule, mga venue, registration, food fair, o history para sa ${y}.`,
      },
    }

    const lang = t[language] || t.en

    // ---------- Detect intent (keyword-based, simple) ----------
    const wantsSchedule = /\b(schedule|what\s+events|when|what\s+is\s+happening|lineup)\b/.test(lowerQuery)
    const wantsVenue = /\b(venue|where|location|place)\b/.test(lowerQuery)
    const wantsHistory = /\b(history|origin|meaning|buglas|about|tell\s+me\s+about)\b/.test(lowerQuery)
    const wantsRegister = /\b(register|join|participate|sign\s+up|deadline|how\s+to)\b/.test(lowerQuery)
    const wantsFood = /\b(food|delicac|eat|fair|cuisine)\b/.test(lowerQuery)
    const wantsUpcoming = /\b(upcoming|coming|soon|next|future|forward)\b/.test(lowerQuery)
    const wantsSupersession = /\b(change|update|supersed|moved|relocated|new\s+venue|correction)\b/.test(lowerQuery)

    // ---------- Supersession demo ----------
    if (wantsSupersession) {
      const supersededSources = sources.filter(s => s.status === 'superseded')
      const updateSources = sources.filter(s => s.status === 'updated')

      if (supersededSources.length === 0 && updateSources.length === 0) {
        return `${lang.supersessionHeader(year)}\n\n${lang.noMatch(year)}\n\n${lang.scheduleNote}`
      }

      let content = `${lang.supersessionHeader(year)}\n\n`
      for (const sup of updateSources) {
        content += `🆕 **${stripDemoMarker(sup.normalizedText ?? sup.rawText ?? '')}**\n`
        if (sup.supersedesSourceId) {
          const oldSrc = demoSources.find(s => s.id === sup.supersedesSourceId)
          if (oldSrc) {
            content += `   ↪️ Supersedes: ${stripDemoMarker(oldSrc.normalizedText ?? oldSrc.rawText ?? '')}\n`
          }
        }
        content += '\n'
      }
      content += `${lang.scheduleNote}`
      return content
    }

    // ---------- History demo ----------
    if (wantsHistory) {
      // History source is `src-history-meaning` (festivalYear = previousYear).
      const historySource = demoSources.find(s => s.id === 'src-history-meaning')

      if (!historySource) {
        return `${lang.historyHeader}\n\n${lang.noInfo(year)}\n\n${lang.scheduleNote}`
      }

      let content = `${lang.historyHeader}\n\n${stripDemoMarker(historySource.normalizedText ?? historySource.rawText ?? '')}\n\n`
      if (historySource.festivalYear !== year) {
        content += `_(Historical reference from ${historySource.festivalYear})_\n\n`
      }
      content += `${lang.scheduleNote}`
      return content
    }

    // ---------- Registration demo ----------
    if (wantsRegister) {
      const regSource = sources.find(s => (s.normalizedText ?? s.rawText ?? '').toLowerCase().includes('registration'))

      if (!regSource) {
        return `${lang.registrationHeader(year)}\n\n${lang.noMatch(year)}\n\n${lang.scheduleNote}`
      }

      return `${lang.registrationHeader(year)}\n\n${stripDemoMarker(regSource.normalizedText ?? regSource.rawText ?? '')}\n\n[Source]\n\n${lang.scheduleNote}`
    }

    // ---------- Food fair demo ----------
    if (wantsFood) {
      const foodSource = sources.find(s => (s.normalizedText ?? s.rawText ?? '').toLowerCase().includes('food') || (s.normalizedText ?? s.rawText ?? '').toLowerCase().includes('fair'))

      if (!foodSource) {
        return `${lang.foodHeader(year)}\n\n${lang.noMatch(year)}\n\n${lang.scheduleNote}`
      }

      return `${lang.foodHeader(year)}\n\n${stripDemoMarker(foodSource.normalizedText ?? foodSource.rawText ?? '')}\n\n[Source]\n\n${lang.scheduleNote}`
    }

    // ---------- Upcoming demo (temporal filtering) ----------
    if (wantsUpcoming) {
      const upcoming = events.filter(e => new Date(e.startDatetime).getTime() >= now.getTime())

      if (upcoming.length === 0) {
        return `${lang.upcomingHeader(year)}\n\n${lang.noMatch(year)}\n\n${lang.scheduleNote}`
      }

      let content = `${lang.upcomingHeader(year)}\n\n`
      for (const evt of upcoming) {
        const start = new Date(evt.startDatetime).toLocaleDateString('en-PH', {
          timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric',
        })
        const time = new Date(evt.startDatetime).toLocaleTimeString('en-PH', {
          timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit',
        })
        const venueSrc = getVenueSourceForEvent(evt.id)
        const orgSrc = getOrganizerSourceForEvent(evt.id)
        content += `🎭 **${evt.eventName}** — ${start}, ${time}\n`
        if (venueSrc) content += lang.venueLine(extractVenueFromSource(venueSrc, evt.venue), venueSrc) + '\n'
        if (orgSrc) content += lang.organizerLine(extractOrganizerFromSource(orgSrc, evt.organizer), orgSrc) + '\n'
        content += '\n'
      }
      content += `${lang.scheduleNote}`
      return content
    }

    // ---------- Venue demo ----------
    if (wantsVenue) {
      if (events.length === 0) {
        return `${lang.venueHeader(year)}\n\n${lang.noMatch(year)}\n\n${lang.scheduleNote}`
      }

      let content = `${lang.venueHeader(year)}\n\n`
      for (const evt of events) {
        const venueSrc = getVenueSourceForEvent(evt.id)
        const venueName = venueSrc ? extractVenueFromSource(venueSrc, evt.venue) : evt.venue
        const marker = isDemoFixture(venueSrc?.normalizedText ?? undefined) ? '🧪' : '📍'
        content += `${marker} **${evt.eventName}** → ${venueName}\n`
        if (venueSrc) content += `   _(source: ${venueSrc.id})_\n`
        content += '\n'
      }
      content += `${lang.scheduleNote}`
      return content
    }

    // ---------- Schedule demo ----------
    if (wantsSchedule) {
      if (events.length === 0) {
        return `${lang.scheduleHeader(year)}\n\n${lang.noInfo(year)}\n\n${lang.scheduleNote}`
      }

      let content = `${lang.scheduleHeader(year)}\n\n`
      const sorted = [...events].sort((a, b) => new Date(a.startDatetime).getTime() - new Date(b.startDatetime).getTime())
      for (const evt of sorted) {
        const start = new Date(evt.startDatetime).toLocaleDateString('en-PH', {
          timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric',
        })
        const time = new Date(evt.startDatetime).toLocaleTimeString('en-PH', {
          timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit',
        })
        const primary = getPrimarySourcesForEvent(evt.id)
        const firstSrc = primary[0]
        const venueSrc = getVenueSourceForEvent(evt.id)
        const orgSrc = getOrganizerSourceForEvent(evt.id)
        const venueName = venueSrc ? extractVenueFromSource(venueSrc, evt.venue) : evt.venue
        const orgName = orgSrc ? extractOrganizerFromSource(orgSrc, evt.organizer) : evt.organizer

        content += `🎭 **${evt.eventName}** — ${start}, ${time}\n`
        content += `   • Venue: **${venueName}**${venueSrc ? ` _(src: ${venueSrc.id})_` : ''}\n`
        content += `   • Organizer: **${orgName}**${orgSrc ? ` _(src: ${orgSrc.id})_` : ''}\n`
        if (firstSrc) {
          content += `   • Source: ${firstSrc.id}\n`
        }
        content += '\n'
      }
      content += `${lang.scheduleNote}`
      return content
    }

    // ---------- Zero-evidence fallback ----------
    if (lowerQuery.length > 0) {
      return `${lang.noMatch(year)}\n\n${lang.suggestion(year)}\n\n${lang.scheduleNote}`
    }

    return `${lang.noInfo(year)}\n\n${lang.suggestion(year)}\n\n${lang.scheduleNote}`
  }

  private extractCitations(response: string, sources: Source[]): SourceCitation[] {
    const citations: SourceCitation[] = []

    // The response may contain either "[Source]" (whole-document cite) or
    // explicit "_(src: <id>)_" markers (per-claim cite). Handle both.
    const sourceIdsFromMarkers = new Set<string>()
    const srcMarkerRe = /_\(src:\s*([a-zA-Z0-9_-]+)\)_/g
    let m: RegExpExecArray | null
    while ((m = srcMarkerRe.exec(response)) !== null) {
      sourceIdsFromMarkers.add(m[1])
    }

    const usesGenericSource = /\[Source\]/.test(response)

    if (usesGenericSource && sourceIdsFromMarkers.size === 0) {
      for (const s of sources) {
        citations.push(this.toCitation(s))
      }
    } else if (sourceIdsFromMarkers.size > 0) {
      for (const id of sourceIdsFromMarkers) {
        const s = sources.find(src => src.id === id) ?? demoSources.find(src => src.id === id)
        if (s) citations.push(this.toCitation(s))
      }
    }

    return citations
  }

  private toCitation(s: Source): SourceCitation {
    return {
      id: s.id,
      title: s.title ?? (stripDemoMarker(s.normalizedText ?? s.rawText ?? '').substring(0, 100) || 'Untitled source'),
      platform: s.platform as Platform,
      postUrl: s.postUrl,
      publishedAt: s.publishedAt,
      festivalYear: s.festivalYear,
      status: s.status,
      supersedesSourceId: s.supersedesSourceId,
    }
  }

  // ===========================================================================
  // Live mode (unchanged from Phase 4)
  // ===========================================================================

  private async sendMessageLive(request: ChatRequest): Promise<ChatResponse> {
    const url = this.config.edgeFunctionUrl || EDGE_FUNCTION_URL
    const publishableKey = this.config.supabasePublishableKey ?? import.meta.env.SUPABASE_PUBLISHABLE_KEY

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(publishableKey && { apikey: publishableKey }),
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    const data = (await response.json()) as ChatResponse
    if (Array.isArray(data.retrievedSources)) {
      data.retrievedSources = data.retrievedSources.map((s) => this.hydrateSource(s))
    }
    if (Array.isArray(data.retrievedEvents)) {
      data.retrievedEvents = data.retrievedEvents.map((e) => this.hydrateEvent(e))
    }
    return data
  }

  private hydrateSource(s: any): Source {
    return {
      ...s,
      publishedAt: (s.published_at ?? s.publishedAt) ? new Date(s.published_at ?? s.publishedAt) : null,
      ingestedAt: new Date(s.ingested_at ?? s.ingestedAt ?? Date.now()),
      updatedAt: new Date(s.updated_at ?? s.updatedAt ?? Date.now()),
    } as Source
  }

  private hydrateEvent(e: any): Event {
    return {
      ...e,
      startDatetime: new Date(e.start_datetime ?? e.startDatetime),
      endDatetime: new Date(e.end_datetime ?? e.endDatetime),
      deadline: e.deadline ? new Date(e.deadline) : undefined,
      createdAt: new Date(e.created_at ?? e.createdAt ?? Date.now()),
      updatedAt: new Date(e.updated_at ?? e.updatedAt ?? Date.now()),
    } as Event
  }

  // ===========================================================================
  // Public helpers
  // ===========================================================================

  getAvailableYears(): FestivalYear[] {
    const years = new Set<FestivalYear>()
    for (const s of demoSources) if (s.festivalYear !== null) years.add(s.festivalYear)
    for (const e of demoEvents) years.add(e.festivalYear)
    return Array.from(years).sort((a, b) => b - a)
  }

  getCurrentFestivalYear(): FestivalYear {
    return getCurrentFestivalYear()
  }

  resolveFestivalYear(query: string, defaultYear?: FestivalYear) {
    return resolveFestivalYear(query, defaultYear)
  }

  setDemoMode(enabled: boolean): void {
    this.demoMode = enabled
  }

  isDemoMode(): boolean {
    return this.demoMode
  }
}

export const chatService = new ChatService()
export { ChatService }
