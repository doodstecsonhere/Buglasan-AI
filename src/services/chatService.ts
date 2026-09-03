/**
 * Buglasan AI - Chat Service Adapter
 * Unified interface for demo mode and live Supabase Edge Function
 */

import type { Source, Event, FestivalYear, SourceCitation, Platform } from '../types'
import { resolveFestivalYear, getCurrentFestivalYear } from '../utils/dateUtils'
import { 
  demoSources, 
  demoEvents, 
  getCurrentSourcesForYear, 
  getCurrentEventsForYear,
} from '../data/demoData'

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false'
const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || '/functions/v1/chat'

export interface ChatServiceConfig {
  demoMode?: boolean
  edgeFunctionUrl?: string
  supabaseUrl?: string
  supabaseAnonKey?: string
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
  yearResolved: FestivalYear
  language: 'en' | 'ceb' | 'fil'
}

class ChatService {
  private config: ChatServiceConfig
  private demoMode: boolean

  constructor(config: ChatServiceConfig = {}) {
    this.config = config
    this.demoMode = config.demoMode ?? DEMO_MODE
  }

  async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    const festivalYear = request.festivalYear ?? getCurrentFestivalYear()
    
    if (this.demoMode) {
      return this.sendMessageDemo(request, festivalYear)
    }
    
    return this.sendMessageLive(request)
  }

  private async sendMessageDemo(request: ChatRequest, festivalYear: FestivalYear): Promise<ChatResponse> {
    const { message, language = 'en' } = request
    
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400))
    
    const sources = getCurrentSourcesForYear(festivalYear)
    const events = getCurrentEventsForYear(festivalYear)
    
    const responseContent = this.generateDemoResponse(message, festivalYear, sources, events, language)
    const citations = this.extractCitations(responseContent, sources)
    
    return {
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: responseContent,
        timestamp: new Date().toISOString(),
        sources: citations,
        festivalYear,
      },
      retrievedSources: sources,
      retrievedEvents: events,
      yearResolved: festivalYear,
      language,
    }
  }

  private async sendMessageLive(request: ChatRequest): Promise<ChatResponse> {
    const url = this.config.edgeFunctionUrl || EDGE_FUNCTION_URL
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.supabaseAnonKey && { 'Authorization': `Bearer ${this.config.supabaseAnonKey}` }),
      },
      body: JSON.stringify(request),
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    
    return response.json()
  }

  private generateDemoResponse(
    query: string, 
    year: FestivalYear, 
    sources: Source[], 
    events: Event[],
    language: 'en' | 'ceb' | 'fil'
  ): string {
    const lowerQuery = query.toLowerCase()
    
    const t = {
      en: {
        schedule: "Here's the **Buglasan Festival {year}** main schedule:",
        venues: "The **main venues** for Buglasan Festival {year} are:",
        history: "**Buglasan Festival** comes from the Visayan word *\"buglas\"* meaning \"to scatter\" or \"sprinkle\" — symbolizing the scattering of seeds, blessings, and the coming together of Negros Oriental's towns.",
        default: "I can help you with information about the **Buglasan Festival {year}**!",
        noInfo: "No current official information found for {year}.",
        historical: " (Historical reference from {histYear})",
      },
      ceb: {
        schedule: "Ani ang **Buglasan Festival {year}** nga pangunahing schedule:",
        venues: "Ang **punong mga venue** alang sa Buglasan Festival {year}:",
        history: "Ang **Buglasan Festival** gikan sa pulong Bisaya nga *\"buglas\"* nga nangahulugan \"pagpanggas\" o \"pagpanghigpit\" — nagpasabot sa pagpanggas sa mga buto, mga bendisyon, ug ang pagtigum sa mga lungsod sa Negros Oriental.",
        default: "Makatabang ko nimo bahin sa **Buglasan Festival {year}**!",
        noInfo: "Walay kasamtangang opisyal nga impormasyon nga nakaplagan alang sa {year}.",
        historical: " (Historical reference gikan sa {histYear})",
      },
      fil: {
        schedule: "Narito ang **Buglasan Festival {year}** pangunahing schedule:",
        venues: "Ang **pangunahing mga venue** para sa Buglasan Festival {year}:",
        history: "Ang **Buglasan Festival** ay nagmula sa salitang Bisaya na *\"buglas\"* na nangangahulugan \"magkalat\" o \"magsabog\" — sumisimbolo sa pagkakalat ng mga binhi, pagpapala, at pagtitipon ng mga bayan ng Negros Oriental.",
        default: "Matutulungan kita sa impormasyon tungkol sa **Buglasan Festival {year}**!",
        noInfo: "Walang kasalukuyang opisyal na impormasyon na nahanap para sa {year}.",
        historical: " (Historical reference mula sa {histYear})",
      },
    }
    
    const lang = t[language] || t.en
    
    if (lowerQuery.includes('schedule') || lowerQuery.includes('events') || lowerQuery.includes('what') || lowerQuery.includes('when')) {
      let content = lang.schedule.replace('{year}', year.toString()) + '\n\n'
      
      const scheduleEvents = events.filter(e => e.category === 'ceremony' || e.category === 'competition' || e.category === 'parade')
      if (scheduleEvents.length > 0) {
        for (const evt of scheduleEvents) {
          const start = new Date(evt.startDatetime).toLocaleDateString('en-PH', { 
            timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' 
          })
          const time = new Date(evt.startDatetime).toLocaleTimeString('en-PH', { 
            timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' 
          })
          content += `🎭 **${evt.eventName}** - ${start}, ${time} @ ${evt.venue}\n`
        }
      } else {
        content += lang.noInfo.replace('{year}', year.toString())
      }
      
      content += '\n*Note: Schedule subject to change. Check official sources for updates.*'
      return content
    }
    
    if (lowerQuery.includes('venue') || lowerQuery.includes('where') || lowerQuery.includes('location')) {
      let content = lang.venues.replace('{year}', year.toString()) + '\n\n'
      
      const venueMap = new Map<string, Event[]>()
      for (const evt of events) {
        if (!venueMap.has(evt.venue)) venueMap.set(evt.venue, [])
        venueMap.get(evt.venue)!.push(evt)
      }
      
      for (const [venue, venueEvents] of venueMap) {
        content += `📍 **${venue}**\n`
        for (const evt of venueEvents) {
          content += `   • ${evt.eventName} (${evt.category})\n`
        }
        content += '\n'
      }
      
      const venueUpdateSource = sources.find(s => 
        s.normalizedText.toLowerCase().includes('venue') && 
        s.normalizedText.toLowerCase().includes('change')
      )
      if (venueUpdateSource) {
        content += `💡 **Update for ${year}**: ${venueUpdateSource.normalizedText.substring(0, 200)}...`
      }
      
      return content
    }
    
    if (lowerQuery.includes('history') || lowerQuery.includes('origin') || lowerQuery.includes('meaning') || lowerQuery.includes('buglas')) {
      const historySource = sources.find(s => 
        s.normalizedText.toLowerCase().includes('origin') || 
        s.normalizedText.toLowerCase().includes('history') ||
        s.normalizedText.toLowerCase().includes('buglas')
      )
      
      let content = lang.history
      if (historySource && historySource.festivalYear !== year) {
        content += lang.historical.replace('{histYear}', historySource.festivalYear.toString())
      }
      return content
    }
    
    if (lowerQuery.includes('register') || lowerQuery.includes('join') || lowerQuery.includes('participate') || lowerQuery.includes('deadline')) {
      const regSource = sources.find(s => 
        s.normalizedText.toLowerCase().includes('registration') || 
        s.normalizedText.toLowerCase().includes('deadline')
      )
      
      if (regSource) {
        return `📝 **Registration Info for ${year}**:\n\n${regSource.normalizedText}\n\n[Source 1]`
      }
      
      return `Registration details for ${year} will be announced closer to the festival. Check the official Facebook page for updates.`
    }
    
    if (lowerQuery.includes('food') || lowerQuery.includes('delicac') || lowerQuery.includes('eat') || lowerQuery.includes('fair')) {
      const foodSource = sources.find(s => 
        s.normalizedText.toLowerCase().includes('food') || 
        s.normalizedText.toLowerCase().includes('delicac') ||
        s.normalizedText.toLowerCase().includes('fair')
      )
      
      if (foodSource) {
        return `🍽️ **Buglasan Food Fair ${year}**:\n\n${foodSource.normalizedText}\n\n[Source 1]`
      }
      
      return `The Buglasan Food Fair features Negros Oriental delicacies like Budbod Kabog, Silvanas, Piaya, and Buko Pie. Check official sources for ${year} details.`
    }
    
    let content = lang.default.replace('{year}', year.toString()) + '\n\n'
    content += `Try asking about:\n`
    content += `• 📅 **Schedule** - "What's the schedule for ${year}?"\n`
    content += `• 📍 **Venues** - "Where is the street dancing held?"\n`
    content += `• 🎫 **Registration** - "How to join the street dancing?"\n`
    content += `• 🍽️ **Food Fair** - "What local delicacies are featured?"\n`
    content += `• 📜 **History** - "What does Buglasan mean?"\n\n`
    content += `Or tap one of the suggested questions below!`
    
    return content
  }

  private extractCitations(response: string, sources: Source[]): SourceCitation[] {
    const citations: SourceCitation[] = []
    
    const sourceRefs = response.match(/\[Source (\d+)\]/g)
    if (sourceRefs) {
      const usedIndices = new Set(sourceRefs.map(r => parseInt(r.match(/\d+/)?.[0] || '0') - 1))
      
      for (const idx of usedIndices) {
        if (idx >= 0 && idx < sources.length) {
          const s = sources[idx]
          citations.push({
            id: s.id,
            title: s.normalizedText.substring(0, 100),
            platform: s.platform as Platform,
            postUrl: s.postUrl,
            publishedAt: s.publishedAt,
            festivalYear: s.festivalYear,
            isCurrent: s.isCurrent,
            supersedesSourceId: s.supersedesSourceId,
          })
        }
      }
    }
    
    return citations
  }

  getAvailableYears(): FestivalYear[] {
    const years = new Set<FestivalYear>()
    for (const s of demoSources) years.add(s.festivalYear)
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