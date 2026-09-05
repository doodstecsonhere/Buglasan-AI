/**
 * Buglasan AI - Type Definitions
 * Core domain types for the festival-aware AI companion
 */

export type FestivalYear = number

export type Platform = 'facebook' | 'instagram' | 'website' | 'pdf' | 'news' | 'official'
export type SourceType = 'text' | 'image' | 'video' | 'link' | 'mixed' | 'unknown'
export type CollectionMethod = 'manual' | 'meta_graph_api' | 'admin_export' | 'other'

/**
 * Canonical Source Status Model
 *
 * | Status       | Meaning                                                            | is_current (derived) |
 * | ------------ | ------------------------------------------------------------------ | -------------------- |
 * | `active`     | Current, authoritative announcement for its festival year          | `true`               |
 * | `updated`    | Supersedes a previous source; the new authoritative version        | `true`               |
 * | `superseded` | Replaced by a newer `updated` source; preserved for history        | `false`              |
 * | `cancelled`  | Information explicitly cancelled (event cancelled, withdrawn)      | `false`              |
 * | `postponed`  | CURRENT evidence of a postponement; the source itself is fresh    | `true`               |
 * | `archived`   | Historical record from past festival years; not current            | `false`              |
 *
 * IMPORTANT — source vs event asymmetry (see README "Source vs Event
 * Postponement Semantics"):
 *   sources.status = 'postponed'  →  sources.is_current = TRUE
 *   events.status  = 'postponed'  →  events.is_current  = FALSE
 * Do not "normalize" this. A fresh postponement post is authoritative
 * current evidence about the postponement; the (different) postponed event
 * row is no longer actively scheduled.
 *
 * `is_current` is a GENERATED ALWAYS AS (status IN ('active', 'updated', 'postponed')) STORED column in DB
 * NOT user-settable - derived from status automatically
 */
export type SourceStatus = 'active' | 'updated' | 'superseded' | 'cancelled' | 'postponed' | 'archived'

export type EventCategory = 
  | 'ceremony' 
  | 'competition' 
  | 'exhibit' 
  | 'food' 
  | 'trade' 
  | 'cultural' 
  | 'sports' 
  | 'workshop' 
  | 'concert' 
  | 'parade' 
  | 'other'

/**
 * Event Status
 *
 * IMPORTANT — source vs event asymmetry (see README "Source vs Event
 * Postponement Semantics"):
 *   events.status = 'postponed' → events.is_current = FALSE.
 *   A postponed event is NO LONGER actively scheduled at its original time;
 *   the new scheduled event (status = 'scheduled' | 'confirmed') is what
 *   represents the now-scheduled occurrence. Do not flip this to true.
 *
 * `isEventCurrent` retains the status-derived domain default:
 * - `scheduled`, `confirmed` → current
 * - `cancelled`, `postponed`, `completed` → not current
 * Since Phase 6 migration 007, the DB's events.is_current column is independently
 * writable so an older extraction fingerprint can be retained as non-current audit
 * history without changing its status. Runtime types and helper behavior are unchanged.
 */
export type EventStatus = 'scheduled' | 'confirmed' | 'cancelled' | 'postponed' | 'completed'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface Source {
  id: string
  platform: Platform
  postId: string
  postUrl: string
  publishedAt: Date | null
  postYear?: FestivalYear | null
  festivalYear: FestivalYear | null
  rawText: string | null
  normalizedText: string | null
  title?: string | null
  sourceType?: SourceType
  mediaUrls?: string[]
  collectedAt?: Date
  collectionMethod?: CollectionMethod
  sourceMetadata?: Record<string, unknown>
  status: SourceStatus
  supersedesSourceId?: string
  ingestedAt: Date
  updatedAt: Date
  // isCurrent is now a computed column in DB (GENERATED ALWAYS AS)
  // Not included in TypeScript interface - derive from status when needed:
  // isCurrent = ['active', 'updated', 'postponed'].includes(status)
}

export interface SourceChunk {
  id: string
  sourceId: string
  chunkIndex: number
  content: string
  embedding?: number[]
  metadata: Record<string, unknown>
}

export interface Event {
  id: string
  eventName: string
  aliases: string[]
  description: string
  category: EventCategory
  startDatetime: Date
  endDatetime: Date
  venue: string
  organizer: string
  deadline?: Date
  eligibility?: string
  fees?: string
  contactInfo?: string
  status: EventStatus
  festivalYear: FestivalYear
  createdAt: Date
  updatedAt: Date
  // isCurrent is now a computed column in DB (GENERATED ALWAYS AS)
  // Not included in TypeScript interface - derive from status when needed:
  // isCurrent = ['scheduled', 'confirmed'].includes(status)
}

export interface EventSource {
  eventId: string
  sourceId: string
  relevanceScore: number
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
  sources?: SourceCitation[]
  festivalYear?: FestivalYear
  metadata?: Record<string, unknown>
}

export interface SourceCitation {
  id: string
  title: string
  platform: Platform
  postUrl: string
  publishedAt: Date | null
  festivalYear: FestivalYear | null
  status: SourceStatus
  supersedesSourceId?: string
  // isCurrent derived from status
}

export interface ChatRequest {
  message: string
  festivalYear?: FestivalYear
  language?: 'en' | 'ceb' | 'fil'
  conversationHistory?: Message[]
}

export interface ChatResponse {
  message: Message
  retrievedSources: Source[]
  retrievedEvents: Event[]
  yearResolved: FestivalYear
  language: 'en' | 'ceb' | 'fil'
}

export interface RetrievalQuery {
  query: string
  festivalYear: FestivalYear
  language: 'en' | 'ceb' | 'fil'
  limit?: number
  includeHistorical?: boolean
}

export interface RetrievalResult {
  sources: Source[]
  events: Event[]
  chunks: SourceChunk[]
}

/**
 * RPC Function Return Types
 */

export interface SearchSourceChunksResult {
  chunkId: string
  sourceId: string
  chunkIndex: number
  content: string
  similarity: number
  sourcePlatform: Platform
  sourcePublishedAt: Date | null
  sourceFestivalYear: FestivalYear | null
  sourceStatus: SourceStatus
  sourceSupersedesSourceId?: string
}

export interface GetFestivalEventsResult {
  id: string
  eventName: string
  aliases: string[]
  description: string
  category: EventCategory
  startDatetime: Date
  endDatetime: Date
  venue: string
  organizer: string
  deadline?: Date
  eligibility?: string
  fees?: string
  contactInfo?: string
  status: EventStatus
  festivalYear: FestivalYear
}

export interface GetSupersessionChainResult {
  sourceId: string
  platform: Platform
  postId: string
  publishedAt: Date | null
  festivalYear: FestivalYear | null
  status: SourceStatus
  supersedesSourceId?: string
  level: number
}

export interface DateResolution {
  resolvedDate: Date
  isRelative: boolean
  originalExpression: string
  confidence: number
}

export interface YearResolution {
  festivalYear: FestivalYear
  isExplicit: boolean
  originalExpression?: string
}

export interface PWAConfig {
  name: string
  shortName: string
  description: string
  themeColor: string
  backgroundColor: string
  icons: Array<{
    src: string
    sizes: string
    type: string
    purpose?: string
  }>
}

/**
 * Helper type guards for derived isCurrent
 */
export function isSourceCurrent(source: Source): boolean {
  return ['active', 'updated', 'postponed'].includes(source.status)
}

export function isEventCurrent(event: Event): boolean {
  return ['scheduled', 'confirmed'].includes(event.status)
}
