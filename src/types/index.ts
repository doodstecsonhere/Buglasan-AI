/**
 * Buglasan AI - Type Definitions
 * Core domain types for the festival-aware AI companion
 */

export type FestivalYear = number

export type Platform = 'facebook' | 'instagram' | 'website' | 'pdf' | 'news' | 'official'

export type SourceStatus = 'active' | 'superseded' | 'archived' | 'draft'

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

export type EventStatus = 'scheduled' | 'confirmed' | 'cancelled' | 'postponed' | 'completed'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface Source {
  id: string
  platform: Platform
  postId: string
  postUrl: string
  publishedAt: Date
  festivalYear: FestivalYear
  rawText: string
  normalizedText: string
  isCurrent: boolean
  status: SourceStatus
  supersedesSourceId?: string
  ingestedAt: Date
  updatedAt: Date
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
  isCurrent: boolean
  festivalYear: FestivalYear
  createdAt: Date
  updatedAt: Date
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
  publishedAt: Date
  festivalYear: FestivalYear
  isCurrent: boolean
  supersedesSourceId?: string
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