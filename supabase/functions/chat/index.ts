import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { SCHEDULE_2026, FESTIVAL_YEAR, FESTIVAL_TIMEZONE, ABOUT, type FestivalEvent } from './schedule-data.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.0-flash'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
}

interface ChatRequest {
  message: string
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}

// --- Rate limiting (in-memory, per-IP, sliding window) ---
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 15
const ipHits = new Map<string, number[]>()

function rateLimit(ip: string): boolean {
  const now = Date.now()
  const hits = (ipHits.get(ip) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW_MS)
  if (hits.length >= RATE_LIMIT_MAX_REQUESTS) return false
  hits.push(now)
  ipHits.set(ip, hits)
  return true
}

function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

function formatSchedule(events: FestivalEvent[]): string {
  return events.map(e => {
    const date = new Date(e.date + 'T' + e.time + ':00').toLocaleString('en-PH', {
      timeZone: FESTIVAL_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    const note = e.note ? `\n  Note: ${e.note}` : ''
    const inferred = e.timeInferred ? ' (time inferred)' : ''
    const holiday = e.legalHoliday ? ' [Legal Holiday]' : ''
    return `${date}${inferred}${holiday} — ${e.title} @ ${e.venue}${note}`
  }).join('\n')
}

const SYSTEM_PROMPT = `You are Buglasan AI, a friendly assistant for the Buglasan Festival ${FESTIVAL_YEAR} in Negros Oriental, Philippines.

You answer questions about the festival schedule, events, venues, and general festival information using ONLY the schedule data and about info provided below. You do not use any prior knowledge about the festival.

RULES:
1. Answer ONLY using the provided schedule and about info. Never invent or hallucinate facts.
2. If asked about something not in the data, say you don't have that information.
3. The schedule is for ${FESTIVAL_YEAR}. All dates are in ${FESTIVAL_TIMEZONE} (Asia/Manila, UTC+8).
4. Be warm, concise, and helpful.
5. For questions about "today" or "tomorrow", resolve relative to the current date provided below.
6. The meaning of "Buglasan" is approximate — say so if asked.
7. This is an unofficial, operator-curated app, not affiliated with the Provincial Government.

=== ABOUT ===
Festival: ${ABOUT.name}
Region: ${ABOUT.region}
Host City: ${ABOUT.host_city}
Typical Month: ${ABOUT.typical_month}
Official Source: ${ABOUT.official_source}
Meaning: ${ABOUT.meaning_note}

=== FULL SCHEDULE (${FESTIVAL_YEAR}, ${SCHEDULE_2026.length} events) ===
${formatSchedule(SCHEDULE_2026)}`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const ip = getClientIp(req)
  if (!rateLimit(ip)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  try {
    const body: ChatRequest = await req.json()
    const { message, conversationHistory = [] } = body
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const now = new Date().toLocaleString('en-PH', { timeZone: FESTIVAL_TIMEZONE })

    const historyText = conversationHistory
      .slice(-6)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')

    const prompt = `${SYSTEM_PROMPT}

=== CURRENT DATE (Asia/Manila) ===
${now}

=== CONVERSATION HISTORY ===
${historyText || 'No previous messages'}

=== USER QUERY ===
${message}

Answer the user's question using ONLY the schedule and about info above. Be concise and friendly.`

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error')
      console.error('Gemini API error:', response.status, errText)
      return new Response(JSON.stringify({ error: 'The AI service is temporarily unavailable. Please try again.' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text?.trim()) {
      return new Response(JSON.stringify({ error: 'No response generated. Please try again.' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ reply: text.trim() }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Chat function error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
