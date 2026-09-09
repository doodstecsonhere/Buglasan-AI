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
    return url.protocol === 'https:' || url.protocol === 'http:'
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
