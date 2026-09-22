import type { FestivalYear } from '../types'
import { getCurrentEventsForYear, getCurrentSourcesForYear } from '../data/demoData'
import { createDemoResponse } from './demoChatResponder'
import type { ChatRequest, ChatResponse } from './chatService'

export async function sendDemoMessage(
  request: ChatRequest,
  festivalYear: FestivalYear,
  language: ChatResponse['language'],
  mapCitations: (response: string, sources: ChatResponse['retrievedSources']) => Pick<ChatResponse['message'], 'sources' | 'claimCitations'>
): Promise<ChatResponse> {
  await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 400))
  const sources = getCurrentSourcesForYear(festivalYear)
  const events = getCurrentEventsForYear(festivalYear)
  const content = createDemoResponse(request.message, festivalYear, sources, events, language)
  const { sources: sourcesCitations, claimCitations } = mapCitations(content, sources)
  return {
    message: { id: crypto.randomUUID(), role: 'assistant', content, timestamp: new Date().toISOString(), sources: sourcesCitations, festivalYear, claimCitations },
    retrievedSources: sources,
    retrievedEvents: events,
    retrievedChunks: [],
    yearResolved: festivalYear,
    language,
  }
}
