export type SupportedLanguage = 'en' | 'ceb' | 'fil'

export interface GroundingSourceRecord {
  id: string
  post_id: string
  normalized_text: string | null
  raw_text: string | null
  platform: string
  post_url: string
  published_at: string | null
  festival_year: number | null
  is_current: boolean
  status: string
  supersedes_source_id?: string
}

export interface ValidatedClaimCitation {
  claimIndex: number
  sourceId: string
  marker: string
}

export function isExactOfficialFacebookPostUrl(value: unknown, postId: unknown): value is string {
  if (typeof value !== 'string' || typeof postId !== 'string' || !postId.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'www.facebook.com' &&
      !url.port && !url.username && !url.password && !url.search && !url.hash &&
      /^\/Buglasan\/posts\/(?:\d+|[^/]+\/\d+)\/$/.test(url.pathname) &&
      url.pathname.endsWith(`/${postId}/`)
  } catch {
    return false
  }
}

/**
 * A citation is a public payload, not merely an internal retrieval reference.
 * Do not attach malformed or non-linkable records just because a model emitted
 * a syntactically valid marker.
 */
export function isValidCitationSource(source: unknown): source is GroundingSourceRecord {
  if (!source || typeof source !== 'object') return false
  const record = source as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id.trim()) return false
  if (typeof record.post_id !== 'string' || !record.post_id.trim()) return false
  if (typeof record.post_url !== 'string' || !record.post_url.trim()) return false
  if (typeof record.platform !== 'string' || !record.platform.trim()) return false
  if (typeof record.festival_year !== 'number' || !Number.isInteger(record.festival_year)) return false
  try {
    const url = new URL(record.post_url)
    return record.platform === 'facebook'
      ? isExactOfficialFacebookPostUrl(record.post_url, record.post_id)
      : url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Explicit language instructions in the message take precedence over UI state. */
export function resolveLanguage(message: string, requested: SupportedLanguage = 'en'): SupportedLanguage {
  const text = message.toLowerCase()
  if (/\b(in|use|reply|respond|answer|speak|write)\b[^.!?\n]{0,30}\b(cebuano|bisaya)\b|\b(cebuano|bisaya)\b[^.!?\n]{0,20}\b(reply|answer|please)\b/.test(text)) return 'ceb'
  if (/\b(in|use|reply|respond|answer|speak|write)\b[^.!?\n]{0,30}\b(filipino|tagalog)\b|\b(filipino|tagalog)\b[^.!?\n]{0,20}\b(reply|answer|please)\b/.test(text)) return 'fil'
  if (/\b(in|use|reply|respond|answer|speak|write)\b[^.!?\n]{0,30}\b(english)\b|\b(english)\b[^.!?\n]{0,20}\b(reply|answer|please)\b/.test(text)) return 'en'
  return requested
}

/** Map only explicit, valid markers to retrieved records. */
export function mapValidatedClaimCitations(response: string, sources: readonly GroundingSourceRecord[]): { sourceIds: string[]; claims: ValidatedClaimCitation[] } {
  const validSources = sources.filter(isValidCitationSource)
  const byId = new Map(validSources.map((source) => [source.id, source]))
  const sourceIds: string[] = []
  const claims: ValidatedClaimCitation[] = []
  const seen = new Set<string>()
  let claimIndex = 0
  for (const match of response.matchAll(/_\(src:\s*([a-zA-Z0-9_-]+)\)_|\[source\s+(\d+)\]/gi)) {
    // Positional citations are interpreted against the exact prompt source
    // ordering, then rejected unless their target is safe for the public API.
    const sourceId = match[1] ?? sources[Number(match[2]) - 1]?.id
    if (!sourceId || !byId.has(sourceId) || seen.has(sourceId)) continue
    seen.add(sourceId)
    sourceIds.push(sourceId)
    claims.push({ claimIndex: claimIndex++, sourceId, marker: match[0] })
  }
  return { sourceIds, claims }
}

export interface EvidencePresence {
  sources: readonly unknown[]
  events: readonly unknown[]
  chunks: readonly unknown[]
}

export const OFFICIAL_BUGLASAN_FACEBOOK_URL = 'https://www.facebook.com/Buglasan'

/**
 * General conversation is intentionally narrow: these requests do not need
 * festival evidence and should continue to be handled conversationally by the
 * language model. Festival facts embedded in an otherwise conversational
 * request are not classified as general conversation.
 */
export function isGeneralConversation(query: string): boolean {
  const normalized = query.toLowerCase().replace(/[!?.,]+/g, ' ').replace(/\s+/g, ' ').trim()

  if (!normalized) return false

  const generalPatterns = [
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|maayong\s+(buntag|hapon|gabii)|kumusta|kamusta)(\s+(there|buglasan\s+ai))?$/,
    /^(thanks|thank\s+you|salamat|daghang\s+salamat|bye|goodbye|paalam)$/,
    /^(help|help\s+me|tabang|tabangi\s+ko|tulong|tulungan\s+mo\s+ako)$/,
    /^(what\s+can\s+you\s+do|how\s+can\s+you\s+help(\s+me)?|what\s+can\s+i\s+ask(\s+you)?|unsa(y)?\s+imong\s+mahimo|unsaon\s+nimo\s+pagtabang|ano(ng)?\s+kaya\s+mong\s+gawin|paano\s+ka\s+makakatulong)$/,
    /^(what\s+languages?\s+(do\s+you\s+speak|can\s+you\s+use|do\s+you\s+support)|can\s+you\s+speak\s+(english|cebuano|bisaya|filipino|tagalog)|kabalo\s+ka\s+mo(?:sulti|storya)\s+(ug\s+)?(english|cebuano|bisaya|filipino|tagalog)|marunong\s+ka\s+ba\s+mag-(english|cebuano|bisaya|filipino|tagalog))$/,
  ]

  return generalPatterns.some((pattern) => pattern.test(normalized))
}

/** Greetings and small talk are handled locally so they never depend on retrieval or a provider. */
export function getLightweightConversationResponse(query: string, language: SupportedLanguage): string | undefined {
  const normalized = query.toLowerCase().replace(/[!?.,]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^(hi|hello|hey|good\s+(morning|afternoon|evening)|maayong\s+(buntag|hapon|gabii)|kumusta|kamusta)(\s+(there|buglasan\s+ai))?$/.test(normalized)) {
    return {
      en: 'Hello! I can help with verified Buglasan Festival information, such as official schedules, events, and announcements.',
      ceb: 'Maayong adlaw! Makatabang ko sa beripikadong impormasyon sa Buglasan Festival, sama sa opisyal nga iskedyul, kalihokan, ug mga pahibalo.',
      fil: 'Kumusta! Makakatulong ako sa beripikadong impormasyon tungkol sa Buglasan Festival, tulad ng opisyal na iskedyul, mga kaganapan, at anunsyo.',
    }[language]
  }
  if (/^(thanks|thank\s+you|salamat|daghang\s+salamat|bye|goodbye|paalam)$/.test(normalized)) {
    return { en: 'You’re welcome!', ceb: 'Walay sapayan!', fil: 'Walang anuman!' }[language]
  }
  if (/^(help|help\s+me|tabang|tabangi\s+ko|tulong|tulungan\s+mo\s+ako|what\s+can\s+you\s+do|how\s+can\s+you\s+help(\s+me)?|what\s+can\s+i\s+ask(\s+you)?)$/.test(normalized)) {
    return {
      en: 'I can help with verified Buglasan Festival schedules, events, announcements, and registration information. Ask me about a specific festival year or event.',
      ceb: 'Makatabang ko sa beripikadong iskedyul, kalihokan, pahibalo, ug impormasyon sa rehistrasyon sa Buglasan Festival. Pangutan-a ko bahin sa piho nga tuig o kalihokan.',
      fil: 'Makakatulong ako sa beripikadong iskedyul, mga kaganapan, anunsyo, at impormasyon sa pagpaparehistro ng Buglasan Festival. Magtanong tungkol sa isang partikular na taon o kaganapan.',
    }[language]
  }
  return undefined
}

/** Keep the endpoint within its documented festival-information scope. */
export function getOutOfScopeResponse(query: string, language: SupportedLanguage): string | undefined {
  if (isFestivalInformationQuery(query) || isGeneralConversation(query) || getDeterministicHarmlessResponse(query) !== undefined) return undefined
  return {
    en: 'I’m Buglasan AI, so I can help with verified Buglasan Festival information such as official schedules, events, announcements, and registrations.',
    ceb: 'Buglasan AI ko. Makatabang ko sa beripikadong impormasyon sa Buglasan Festival sama sa opisyal nga iskedyul, kalihokan, pahibalo, ug rehistrasyon.',
    fil: 'Ako ang Buglasan AI. Makakatulong ako sa beripikadong impormasyon tungkol sa Buglasan Festival, tulad ng opisyal na iskedyul, mga kaganapan, anunsyo, at pagpaparehistro.',
  }[language]
}

/** Small, deterministic calculations are not festival claims and need no retrieval or provider call. */
export function getDeterministicHarmlessResponse(query: string): string | undefined {
  const normalized = query.toLowerCase()
    .replace(/[?=]/g, ' ')
    .replace(/^(what(?:'s|s|\s+is)|calculate|compute)\s+/i, '')
    .replace(/\b(plus|minus|times|multiplied\s+by|divided\s+by)\b/g, (operator) => {
      const operators: Record<string, string> = {
        plus: '+', minus: '-', times: '*', 'multiplied by': '*', 'divided by': '/',
      }
      return ` ${operators[operator]} `
    })
    .trim()
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return undefined
  const left = Number(match[1])
  const right = Number(match[3])
  const result = match[2] === '+' ? left + right : match[2] === '-' ? left - right : match[2] === '*' ? left * right : right === 0 ? undefined : left / right
  return result === undefined || !Number.isFinite(result) ? 'I cannot divide by zero.' : String(result)
}

export function isTemporalOnlyQuery(query: string): boolean {
  const normalized = query.toLowerCase().replace(/[?!.,]+/g, ' ').replace(/\s+/g, ' ').trim()
  return /^(what(?:'s| is)?\s+(?:happening\s+)?|anything\s+)?(?:today|tomorrow|tmrw)$/.test(normalized)
}

/** A date window is answerable only from canonical event records, not generic source text. */
export function isEventWindowQuery(query: string): boolean {
  return /\b(today|tomorrow|tmrw|this\s+week(?:end)?|next\s+week(?:end)?|upcoming|coming\s+(?:up|soon)|happening|events?|activities|schedule|date|when|latest|current)\b/i.test(query)
}

/** Broad future-discovery language may not contain a proper noun for lexical matching. */
export function isFutureDiscoveryQuery(query: string): boolean {
  return /\b(coming\s+up|coming\s+soon|upcoming|what(?:'s|\s+is)\s+(?:happening|on)|anything\s+(?:interesting\s+)?(?:coming\s+up|upcoming))\b/i.test(query)
}

/**
 * Detect requests that could produce factual festival claims. This includes
 * festival names plus common fact-seeking vocabulary in supported languages.
 */
export function isFestivalInformationQuery(query: string): boolean {
  if (isGeneralConversation(query)) return false

  return /\b(buglasan|festival|schedule|lineup|event|activity|date|time|when|where|venue|location|organizer|history|origin|tradition|announcement|registration|register|deadline|parade|competition|food\s+fair|opening|closing|iskedyul|kalihokan|petsa|oras|kanus-a|asa|lugar|tig-organisa|kasaysayan|tradisyon|pahibalo|rehistro|kaganapan|kailan|saan|tagapag-organisa|anunsyo|pagpaparehistro)\b/i.test(query)
}

export function hasUsableEvidence(evidence: EvidencePresence): boolean {
  // `get_festival_events` returns the year's canonical rows and is not a
  // semantic query matcher. Treating any such row as evidence allows an
  // unsupported factual question to bypass the refusal path. A source/chunk is
  // required because it is query-relevant, independently attributable evidence.
  return evidence.sources.length > 0 || evidence.chunks.length > 0
}

export function shouldUseZeroEvidenceFallback(query: string, evidence: EvidencePresence): boolean {
  return isFestivalInformationQuery(query) && !hasUsableEvidence(evidence)
}

/**
 * This message is deliberately fixed server-side. Keep it free of festival
 * facts other than the already-resolved year and the official verification
 * destination.
 */
export function buildZeroEvidenceFallback(year: number, language: SupportedLanguage): string {
  const messages: Record<SupportedLanguage, string> = {
    en: `No current official information was found for Buglasan Festival ${year}. Please check the official Buglasan Festival Facebook Page for verified updates: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
    ceb: `Walay nakaplagang kasamtangang opisyal nga impormasyon alang sa Buglasan Festival ${year}. Palihog tan-awa ang opisyal nga Buglasan Festival Facebook Page alang sa beripikadong mga update: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
    fil: `Walang nakitang kasalukuyang opisyal na impormasyon para sa Buglasan Festival ${year}. Pakitingnan ang opisyal na Buglasan Festival Facebook Page para sa mga beripikadong update: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
  }

  return messages[language]
}

export function buildNoVerifiedEventListingFallback(year: number, language: SupportedLanguage): string {
  return {
    en: `No verified Buglasan Festival ${year} event listing matches that time window. Please check the official Buglasan Festival Facebook Page for verified updates: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
    ceb: `Walay beripikadong listahan sa kalihokan sa Buglasan Festival ${year} nga motakdo sa maong panahon. Palihog tan-awa ang opisyal nga Buglasan Festival Facebook Page alang sa beripikadong mga update: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
    fil: `Walang beripikadong listahan ng kaganapan ng Buglasan Festival ${year} na tumutugma sa panahong iyon. Pakitingnan ang opisyal na Buglasan Festival Facebook Page para sa mga beripikadong update: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
  }[language]
}

export function buildTemporaryServiceError(language: SupportedLanguage): string {
  return {
    en: 'Buglasan AI is temporarily unavailable. Please try again shortly.',
    ceb: 'Temporaryong dili magamit ang Buglasan AI. Palihog sulayi pag-usab sa dili madugay.',
    fil: 'Pansamantalang hindi available ang Buglasan AI. Pakisubukang muli sa ilang sandali.',
  }[language]
}

/** Use only when generation failed after trusted, query-relevant evidence was retrieved. */
export function buildGroundedGenerationFallback(language: SupportedLanguage): string {
  return {
    en: 'I found relevant official Buglasan information, but I cannot safely generate a full answer right now. Please review the verified source below or try again shortly.',
    ceb: 'Nakaplagan ko ang may kalabutan nga opisyal nga impormasyon sa Buglasan, apan dili ko luwas nga makamugna og hingpit nga tubag karon. Palihog susiha ang beripikadong tinubdan sa ubos o sulayi pag-usab sa dili madugay.',
    fil: 'May nakita akong kaugnay na opisyal na impormasyon tungkol sa Buglasan, ngunit hindi ako ligtas na makakagawa ng buong sagot ngayon. Pakisuri ang beripikadong source sa ibaba o subukang muli sa ilang sandali.',
  }[language]
}

/** Server-side wording rule for inclusive calendar-date calculations. */
export function buildInclusiveDateArithmeticGuidance(language: SupportedLanguage): string {
  if (language === 'fil') {
    return 'Para sa Filipino/Tagalog na tanong tungkol sa bilang ng araw sa pagitan ng dalawang petsa, bilangin ang parehong unang at huling petsa. Halimbawa, Oktubre 10 hanggang Oktubre 12 ay "3 araw lahat (kasama ang Oktubre 10 at Oktubre 12)"; huwag tawaging 2 araw.'
  }
  return 'For calendar-date duration questions, count both the start and end dates unless the user explicitly asks for elapsed time.'
}

const LEXICAL_STOP_WORDS = new Set([
  'about', 'after', 'before', 'buglasan', 'current', 'event', 'festival',
  'from', 'information', 'schedule', 'their', 'there', 'these', 'this',
  'where', 'which', 'with', 'when', 'what', 'will', 'year',
])

/** Extract proper-noun candidates for exact-year lexical retrieval fallback. */
export function getLexicalEvidenceTerms(query: string): string[] {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) ?? [])
    .filter((term) => !LEXICAL_STOP_WORDS.has(term)))]
    .slice(0, 3)
}
