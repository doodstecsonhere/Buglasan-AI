/**
 * Buglasan AI - Supabase Edge Function: Chat Endpoint
 * Secure server-side chat with Gemini API, grounding, and citations
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0'

// ============================================
// Types
// ============================================
interface ChatRequest {
  message: string
  festivalYear?: number
  language?: 'en' | 'ceb' | 'fil'
  conversationHistory?: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: string
    sources?: SourceCitation[]
  }>
}

interface SourceCitation {
  id: string
  title: string
  platform: string
  postUrl: string
  publishedAt: string
  festivalYear: number
  isCurrent: boolean
  supersedesSourceId?: string
}

interface Source {
  id: string
  platform: string
  post_id: string
  post_url: string
  published_at: string
  festival_year: number
  raw_text: string
  normalized_text: string
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
  yearResolved: number
  language: 'en' | 'ceb' | 'fil'
}

// ============================================
// Configuration
// ============================================
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-1.5-flash'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const PH_TIMEZONE = 'Asia/Manila'

// ============================================
// System Prompt
// ============================================
const SYSTEM_PROMPT = `You are Buglasan AI, a multilingual, year-aware AI companion for the Buglasan Festival of Negros Oriental, Philippines.

CORE PRINCIPLES:
1. GROUNDING: Only answer using provided sources. Never hallucinate.
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
- Festival typically mid-October (15th-25th)
- Default festival year provided in context`

// ============================================
// Helper Functions
// ============================================
function getCurrentFestivalYear(): number {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: PH_TIMEZONE }))
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() // 0-indexed, 9 = October
  return currentMonth >= 9 ? currentYear + 1 : currentYear
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

async function retrieveSources(supabase: any, festivalYear: number, query: string, limit = 10): Promise<Source[]> {
  // Primary: current year, active, non-superseded sources
  const { data: currentSources, error } = await supabase
    .from('sources')
    .select('*')
    .eq('festival_year', festivalYear)
    .eq('is_current', true)
    .eq('status', 'active')
    .order('published_at', { ascending: false })
    .limit(limit)
  
  if (error) {
    console.error('Error retrieving current sources:', error)
    return []
  }
  
  // If few results, also get historical but mark them
  if ((currentSources?.length || 0) < 3) {
    const { data: historicalSources } = await supabase
      .from('sources')
      .select('*')
      .neq('festival_year', festivalYear)
      .eq('is_current', true)
      .eq('status', 'active')
      .order('published_at', { ascending: false })
      .limit(limit - (currentSources?.length || 0))
    
    return [...(currentSources || []), ...(historicalSources || [])]
  }
  
  return currentSources || []
}

async function retrieveEvents(supabase: any, festivalYear: number): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('festival_year', festivalYear)
    .eq('is_current', true)
    .neq('status', 'cancelled')
    .order('start_datetime', { ascending: true })
  
  if (error) {
    console.error('Error retrieving events:', error)
    return []
  }
  
  return data || []
}

function formatSourcesForPrompt(sources: Source[]): string {
  if (sources.length === 0) return 'No sources available.'
  
  return sources.map((s, i) => {
    const date = new Date(s.published_at).toLocaleDateString('en-PH', { 
      timeZone: PH_TIMEZONE, 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    })
    const status = s.is_current && s.status === 'active' ? '✅ Current' : 
                   s.status === 'superseded' ? '🔄 Superseded' : '📦 Archived'
    const supersedes = s.supersedes_source_id ? ` (Updates: ${s.supersedes_source_id})` : ''
    
    return `[Source ${i + 1}] ${s.platform.toUpperCase()} | ${date} | FY${s.festival_year} | ${status}${supersedes}
Title: ${s.normalized_text.substring(0, 500)}${s.normalized_text.length > 500 ? '...' : ''}
URL: ${s.post_url}`
  }).join('\n\n')
}

function formatEventsForPrompt(events: Event[]): string {
  if (events.length === 0) return 'No events found for this festival year.'
  
  return events.map((e, i) => {
    const start = new Date(e.start_datetime).toLocaleString('en-PH', { 
      timeZone: PH_TIMEZONE, 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric', 
      hour: 'numeric', 
      minute: '2-digit' 
    })
    const end = new Date(e.end_datetime).toLocaleString('en-PH', { 
      timeZone: PH_TIMEZONE, 
      hour: 'numeric', 
      minute: '2-digit' 
    })
    
    return `[Event ${i + 1}] ${e.event_name} (${e.category})
Date: ${start} - ${end}
Venue: ${e.venue}
Status: ${e.status}
Description: ${e.description}
${e.deadline ? `Deadline: ${new Date(e.deadline).toLocaleDateString('en-PH', { timeZone: PH_TIMEZONE })}` : ''}
${e.eligibility ? `Eligibility: ${e.eligibility}` : ''}
${e.fees ? `Fees: ${e.fees}` : ''}
${e.contact_info ? `Contact: ${e.contact_info}` : ''}`
  }).join('\n\n')
}

function extractCitations(response: string, sources: Source[]): SourceCitation[] {
  const citations: SourceCitation[] = []
  const sourceRefs = response.match(/\[Source (\d+)\]/g)
  
  if (sourceRefs) {
    const usedIndices = new Set(sourceRefs.map(r => parseInt(r.match(/\d+/)?.[0] || '0') - 1))
    
    for (const idx of usedIndices) {
      if (idx >= 0 && idx < sources.length) {
        const s = sources[idx]
        citations.push({
          id: s.id,
          title: s.normalized_text.substring(0, 100),
          platform: s.platform,
          postUrl: s.post_url,
          publishedAt: s.published_at,
          festivalYear: s.festival_year,
          isCurrent: s.is_current,
          supersedesSourceId: s.supersedes_source_id,
        })
      }
    }
  }
  
  return citations
}

// ============================================
// Main Handler
// ============================================
serve(async (req) => {
  // CORS headers
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
    // Parse request
    const body: ChatRequest = await req.json()
    const { message, festivalYear, language = 'en', conversationHistory = [] } = body
    
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    
    // Initialize clients
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })
    
    // Resolve festival year
    const defaultYear = festivalYear || getCurrentFestivalYear()
    const { year: resolvedYear, isExplicit } = resolveFestivalYear(message, defaultYear)
    
    // Retrieve relevant data
    const [sources, events] = await Promise.all([
      retrieveSources(supabase, resolvedYear, message),
      retrieveEvents(supabase, resolvedYear),
    ])
    
    // Build context
    const sourcesContext = formatSourcesForPrompt(sources)
    const eventsContext = formatEventsForPrompt(events)
    const currentDate = new Date().toLocaleString('en-PH', { timeZone: PH_TIMEZONE })
    
    // Build conversation history for context
    const historyContext = conversationHistory
      .slice(-6) // Last 6 messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')
    
    // Construct prompt
    const prompt = `${SYSTEM_PROMPT}

CURRENT DATE (Asia/Manila): ${currentDate}
RESOLVED FESTIVAL YEAR: ${resolvedYear} ${isExplicit ? '(explicitly requested)' : '(default)'}
USER LANGUAGE: ${language === 'ceb' ? 'Cebuano/Bisaya' : language === 'fil' ? 'Filipino/Tagalog' : 'English'}

=== AVAILABLE SOURCES ===
${sourcesContext}

=== FESTIVAL EVENTS (${resolvedYear}) ===
${eventsContext}

=== CONVERSATION HISTORY ===
${historyContext || 'No previous messages'}

=== USER QUERY ===
${message}

=== INSTRUCTIONS ===
Answer the user's query using ONLY the provided sources and events. 
- Cite sources inline as [Source N]
- If asking about a different year than ${resolvedYear}, clarify you're showing ${resolvedYear} info
- If no current info exists, state: "No current official information found for ${resolvedYear}."
- Respond in ${language === 'ceb' ? 'Cebuano/Bisaya' : language === 'fil' ? 'Filipino/Tagalog' : 'English'}
- Be warm, helpful, and festival-appropriate`

    // Generate response
    const result = await model.generateContent(prompt)
    const responseText = result.response.text()
    
    // Extract citations
    const citations = extractCitations(responseText, sources)
    
    // Build response
    const response: ChatResponse = {
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        sources: citations,
        festivalYear: resolvedYear,
      },
      retrievedSources: sources,
      retrievedEvents: events,
      yearResolved: resolvedYear,
      language,
    }
    
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
    
  } catch (error) {
    console.error('Chat function error:', error)
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})