import type { ChatResponse, ChatRequest } from './chatService'
import type { ChatLanguage, Event, FestivalYear, SourceCitation } from '../types'
import { getCurrentDateInPH } from '../utils/dateUtils'

const STORE_KEY = 'buglasan-ai.verified-knowledge.v1'
const OFFICIAL_FACEBOOK = 'https://www.facebook.com/Buglasan'

export interface VerifiedKnowledgeSnapshot {
  version: 1
  year: FestivalYear
  savedAt: string
  current: boolean
  events: Event[]
  sources: SourceCitation[]
  updates: Array<{ title: string; snippet: string; url: string; publishedAt: string | null }>
}

function safeUrl(value: unknown): value is string {
  try { const url = new URL(String(value)); return url.protocol === 'https:' || url.protocol === 'http:' } catch { return false }
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export async function saveVerifiedKnowledge(response: ChatResponse): Promise<void> {
  const year = response.yearResolved
  const citations = response.message.sources.filter(source => safeUrl(source.postUrl))
  const sources = response.retrievedSources
    .filter(source => source.festivalYear === year && source.status !== 'superseded' && source.status !== 'archived' && safeUrl(source.postUrl))
    .map(source => ({ id: source.id, title: source.title ?? (source.normalizedText ?? source.rawText ?? 'Official Buglasan update').slice(0, 180), platform: source.platform, postUrl: source.postUrl, publishedAt: source.publishedAt, festivalYear: source.festivalYear, status: source.status, postId: source.postId, supersedesSourceId: source.supersedesSourceId }))
  const snapshot: VerifiedKnowledgeSnapshot = {
    version: 1, year, savedAt: new Date().toISOString(), current: year === new Date().getFullYear(),
    events: response.retrievedEvents.filter(event => event.festivalYear === year),
    sources: dedupe([...citations, ...sources]),
    updates: dedupe([...citations, ...sources]).slice(0, 8).map(source => ({ title: source.title, snippet: source.title, url: source.postUrl, publishedAt: source.publishedAt instanceof Date ? source.publishedAt.toISOString() : null })),
  }
  // Atomic replacement: leave the prior complete snapshot intact when serialization fails.
  const target = storage()
  if (!target || (!snapshot.events.length && !snapshot.sources.length)) return
  target.setItem(`${STORE_KEY}.${year}.next`, JSON.stringify(snapshot))
  target.setItem(`${STORE_KEY}.${year}`, JSON.stringify(snapshot))
  target.removeItem(`${STORE_KEY}.${year}.next`)
}

function dedupe(sources: SourceCitation[]): SourceCitation[] {
  return [...new Map(sources.map(source => [source.id, source])).values()]
}

function load(year: FestivalYear): VerifiedKnowledgeSnapshot | null {
  try {
    const raw = storage()?.getItem(`${STORE_KEY}.${year}`)
    const snapshot: unknown = raw ? JSON.parse(raw) : null
    if (!snapshot || typeof snapshot !== 'object') return null
    const value = snapshot as VerifiedKnowledgeSnapshot
    return value.version === 1 && value.year === year && Array.isArray(value.events) && Array.isArray(value.sources) ? value : null
  } catch { return null }
}

const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []
const isAnnouncement = (value: string) => /\b(latest|current|new(?:est)?|recent)\s+(?:official\s+)?(?:update|announcement|advisory|notice)|\b(?:latest|current)\b.*\b(?:update|announcement|advisory|notice)\b/i.test(value)
const dateWindow = (value: string) => /\b(today|tomorrow|tmrw|weekend|upcoming|coming\s+up|schedule|when|date)\b/i.test(value)

export function answerOffline(request: ChatRequest, year: FestivalYear): ChatResponse {
  const language = request.language ?? 'en'
  const snapshot = load(year)
  const now = getCurrentDateInPH()
  const freshness = snapshot ? new Date(snapshot.savedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : ''
  const suffix = snapshot ? `\n\n_${offlineFreshness(language, freshness)}_` : ''
  if (!snapshot) return offlineResponse(noCache(language), [], [], year, language)
  if (isAnnouncement(request.message)) {
    const latest = snapshot.updates[0]
    const content = latest ? `${latest.title}\n${latest.url}${suffix}` : `${noUpdate(language)} ${OFFICIAL_FACEBOOK}${suffix}`
    return offlineResponse(content, latest ? snapshot.sources.slice(0, 1) : [], [], year, language)
  }
  const queryWords = new Set(words(request.message))
  let events = snapshot.events
  if (/\btomorrow|tmrw\b/i.test(request.message)) events = events.filter(event => sameDay(new Date(event.startDatetime), addDays(now, 1)))
  else if (/\btoday\b/i.test(request.message)) events = events.filter(event => sameDay(new Date(event.startDatetime), now))
  else if (/\b(upcoming|coming\s+up)\b/i.test(request.message)) events = events.filter(event => new Date(event.startDatetime) >= now)
  else if (!dateWindow(request.message)) events = events.filter(event => words(`${event.eventName} ${event.venue} ${event.description ?? ''}`).some(word => queryWords.has(word)))
  if (!events.length) return offlineResponse(`${unavailable(language)}${suffix}`, snapshot.sources, [], year, language)
  const lines = events.slice(0, 6).map(event => `• **${event.eventName}** — ${new Date(event.startDatetime).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}${event.venue ? `, ${event.venue}` : ''} (${event.status})`)
  return offlineResponse(`${cachedFacts(language)}\n${lines.join('\n')}${suffix}`, snapshot.sources, events, year, language)
}

function offlineResponse(content: string, sources: SourceCitation[], events: Event[], year: FestivalYear, language: ChatLanguage): ChatResponse {
  return { message: { id: crypto.randomUUID(), role: 'assistant', content, timestamp: new Date().toISOString(), sources, festivalYear: year }, retrievedSources: [], retrievedEvents: events, yearResolved: year, language }
}
function sameDay(a: Date, b: Date) { return a.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) === b.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) }
function addDays(value: Date, days: number) { const next = new Date(value); next.setDate(next.getDate() + days); return next }
function offlineFreshness(language: ChatLanguage, date: string) { return ({ en: `Offline cache saved ${date}. It may be stale.`, ceb: `Offline cache gi-save ${date}. Posibleng dili na kini bag-o.`, fil: `Na-save ang offline cache noong ${date}. Maaaring luma na ito.` })[language] }
function noCache(language: ChatLanguage) { return ({ en: 'You are offline and no verified Buglasan information is cached on this device yet.', ceb: 'Offline ka ug wala pay beripikadong impormasyon sa Buglasan nga na-cache sa kini nga device.', fil: 'Offline ka at wala pang naka-cache na beripikadong impormasyon tungkol sa Buglasan sa device na ito.' })[language] }
function noUpdate(language: ChatLanguage) { return ({ en: 'No cached verified current announcement is available. Check the official Facebook Page when online:', ceb: 'Walay cached nga beripikadong kasamtangang pahibalo. Tan-awa ang opisyal nga Facebook Page kung online na:', fil: 'Walang naka-cache na beripikadong kasalukuyang anunsyo. Tingnan ang opisyal na Facebook Page kapag online:' })[language] }
function unavailable(language: ChatLanguage) { return ({ en: 'The verified offline cache cannot answer that request.', ceb: 'Dili matubag sa beripikadong offline cache ang maong pangutana.', fil: 'Hindi masasagot ng beripikadong offline cache ang tanong na iyon.' })[language] }
function cachedFacts(language: ChatLanguage) { return ({ en: 'Verified cached facts:', ceb: 'Beripikadong cached nga mga kamatuoran:', fil: 'Mga beripikadong naka-cache na detalye:' })[language] }
