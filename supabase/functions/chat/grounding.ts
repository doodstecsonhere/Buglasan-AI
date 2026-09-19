import { canonicalAuthorizedFacebookReelPathPrefix, ragPolicy } from '../../../config/rag-policy.mjs'

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
    const reelId = postId.startsWith('reel-') ? postId.slice('reel-'.length) : postId
    const isCanonicalPost = new RegExp(`^${ragPolicy.citations.postPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\d+|[^/]+/\\d+)/$`).test(url.pathname) &&
      url.pathname.endsWith(`/${postId}/`)
    // The durable source identity prefixes reel post IDs to avoid colliding
    // with numeric /Buglasan/posts IDs; Facebook's canonical reel URL carries
    // only the numeric suffix. Validate both forms without relaxing the route.
    const isCanonicalAuthorizedReel = url.pathname === `${canonicalAuthorizedFacebookReelPathPrefix}${reelId}/`
    return url.protocol === 'https:' &&
      url.hostname === ragPolicy.citations.host &&
      !url.port && !url.username && !url.password && !url.search && !url.hash &&
      (isCanonicalPost || isCanonicalAuthorizedReel)
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

export const OFFICIAL_BUGLASAN_FACEBOOK_URL = ragPolicy.verification.url

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
  if (isFestivalInformationQuery(query) || isGeneralConversation(query)) return undefined
  return {
    en: 'I’m Buglasan AI, so I can help with verified Buglasan Festival information such as official schedules, events, announcements, and registrations.',
    ceb: 'Buglasan AI ko. Makatabang ko sa beripikadong impormasyon sa Buglasan Festival sama sa opisyal nga iskedyul, kalihokan, pahibalo, ug rehistrasyon.',
    fil: 'Ako ang Buglasan AI. Makakatulong ako sa beripikadong impormasyon tungkol sa Buglasan Festival, tulad ng opisyal na iskedyul, mga kaganapan, anunsyo, at pagpaparehistro.',
  }[language]
}

/**
 * Retained only as a parser seam for tests and future festival-specific date
 * arithmetic. General calculations must still be rejected by the scope guard;
 * callers must never use this result as a public response.
 */
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

/** A date window needs either canonical event records or query-relevant source evidence. */
export function isEventWindowQuery(query: string): boolean {
  return /\b(today|tomorrow|tmrw|this\s+week(?:end)?|next\s+week(?:end)?|upcoming|coming\s+(?:up|soon)|happening|events?|activities|schedule|date|when)\b/i.test(query) &&
    !isAnnouncementQuery(query)
}

/** Announcements are source/update questions, not requests for event rows. */
export function isAnnouncementQuery(query: string): boolean {
  return /\b(latest|current|new(?:est)?|recent)\s+(?:official\s+)?(?:update|announcement|advisory|notice)|\b(?:latest|current)\b.*\b(?:update|announcement|advisory|notice)\b/i.test(query)
}

export function buildNoVerifiedAnnouncementFallback(year: number, language: SupportedLanguage): string {
  return {
    en: `No verified current official Buglasan Festival ${year} announcement is available in this response. Please check the official Buglasan Festival Facebook Page for the latest verified update: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
    ceb: `Walay beripikadong kasamtangang opisyal nga pahibalo sa Buglasan Festival ${year} nga available sa kini nga tubag. Palihog tan-awa ang opisyal nga Buglasan Festival Facebook Page alang sa pinakabag-ong beripikadong update: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
    fil: `Walang available na beripikadong kasalukuyang opisyal na anunsyo para sa Buglasan Festival ${year} sa tugon na ito. Pakitingnan ang opisyal na Buglasan Festival Facebook Page para sa pinakabagong beripikadong update: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
  }[language]
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

  // A request for the "latest update" is a factual festival request, even
  // though it does not necessarily contain a schedule/event keyword. Keep it
  // on the grounded route rather than allowing the scope guard to answer it.
  return /\b(buglasan|festival|schedule|lineup|event|activity|date|time|when|where|venue|location|organizer|history|origin|tradition|announcement|update|latest|registration|register|deadline|parade|competition|food\s+fair|opening|closing|iskedyul|kalihokan|petsa|oras|kanus-a|asa|lugar|tig-organisa|kasaysayan|tradisyon|pahibalo|rehistro|kaganapan|kailan|saan|tagapag-organisa|anunsyo|pagpaparehistro)\b/i.test(query)
}

export function hasUsableEvidence(evidence: EvidencePresence): boolean {
  // `get_festival_events` returns the year's canonical rows and is not a
  // semantic query matcher. Treating any such row as evidence allows an
  // unsupported factual question to bypass the refusal path. A source/chunk is
  // required because it is query-relevant, independently attributable evidence.
  return evidence.sources.length > 0 || evidence.chunks.length > 0
}

export function hasQueryRelevantEvidence(query: string, evidence: EvidencePresence): boolean {
  if (!hasUsableEvidence(evidence)) return false
  const terms = getLexicalEvidenceTerms(query)
  if (!terms.length) return true
  const text = [...evidence.sources, ...evidence.chunks].map((item) => {
    if (!item || typeof item !== 'object') return ''
    const record = item as Record<string, unknown>
    return [record.content, record.normalized_text, record.raw_text].filter((value): value is string => typeof value === 'string').join(' ')
  }).join(' ').toLocaleLowerCase()
  return terms.some((term) => text.includes(term))
}

export function shouldUseZeroEvidenceFallback(query: string, evidence: EvidencePresence): boolean {
  return isFestivalInformationQuery(query) && !hasQueryRelevantEvidence(query, evidence)
}

/**
 * This message is deliberately fixed server-side. Keep it free of festival
 * facts other than the already-resolved year and the official verification
 * destination.
 */
export function buildZeroEvidenceFallback(year: number, language: SupportedLanguage): string {
  const messages: Record<SupportedLanguage, string> = {
    en: `No verified current official Buglasan Festival ${year} information matches this request. Please check the official Buglasan Festival Facebook Page for verified updates: ${OFFICIAL_BUGLASAN_FACEBOOK_URL}`,
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

/**
 * Infrastructure and provider-content failures are distinct from an honest
 * no-evidence result. Preserve a grounded route when retrieval already found
 * query-relevant evidence; otherwise return a visible, recoverable DTO body.
 */
export function buildRecoverableFailureFallback(evidence: EvidencePresence, language: SupportedLanguage): string {
  return hasUsableEvidence(evidence)
    ? buildGroundedGenerationFallback(language)
    : buildTemporaryServiceError(language)
}

/** Use only when generation failed after trusted, query-relevant evidence was retrieved. */
export function buildGroundedGenerationFallback(language: SupportedLanguage): string {
  return {
    en: 'I found relevant official Buglasan information, but I cannot safely generate a full answer right now. Please review the verified source below or try again shortly.',
    ceb: 'Nakaplagan ko ang may kalabutan nga opisyal nga impormasyon sa Buglasan, apan dili ko luwas nga makamugna og hingpit nga tubag karon. Palihog susiha ang beripikadong tinubdan sa ubos o sulayi pag-usab sa dili madugay.',
    fil: 'May nakita akong kaugnay na opisyal na impormasyon tungkol sa Buglasan, ngunit hindi ako ligtas na makakagawa ng buong sagot ngayon. Pakisuri ang beripikadong source sa ibaba o subukang muli sa ilang sandali.',
  }[language]
}

/**
 * Build a scoped fallback that preserves the most specific subject from evidence.
 * Used when the generated answer broadened scope and we need to provide a safe,
 * subject-scoped response using the evidence markers.
 */
export function buildScopedFallback(evidenceText: string, language: SupportedLanguage): string {
  const markers = extractSubjectScopeMarkers(evidenceText)
  const childMarkers = markers.filter((marker) => {
    const compact = marker.replace(/^#/, '').replace(/[\s_-]+/g, '').toLocaleLowerCase()
    // Filter out generic festival names and parent festival references
    return compact.length > 0 && !compact.includes('festival') && !compact.includes('buglasan')
  })

  if (childMarkers.length > 0) {
    const primarySubject = childMarkers[0].replace(/^#/, '')
    return {
      en: `For ${primarySubject}, please review the official source below for the latest information.`,
      ceb: `Alang sa ${primarySubject}, palihog susiha ang opisyal nga tinubdan sa ubos alang sa kinabuhing impormasyon.`,
      fil: `Para sa ${primarySubject}, pakisuri ang opisyal na source sa ibaba para sa pinakabagong impormasyon.`,
    }[language]
  }

  // Fallback to generic message if no specific child markers found
  return buildGroundedGenerationFallback(language)
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
  'ang', 'ano', 'asa', 'kailan', 'kanus-a', 'mga', 'ng', 'petsa', 'unsa',
])

/** Extract proper-noun candidates for exact-year lexical retrieval fallback. */
export function getLexicalEvidenceTerms(query: string): string[] {
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) ?? [])
    .filter((term) => !LEXICAL_STOP_WORDS.has(term)))]
    .slice(0, 3)
}

const GENERIC_SUBJECT_HASHTAGS = new Set([
  'venueupdate', 'howto', 'howtoregister', 'seeyouthere', 'register', 'update',
  'newvenue', 'dauin', 'location', 'announcement', 'official', 'festival',
])

const EVENT_KIND = String.raw`Fest(?:ival)?|Camp\s+Fest|Parade|Concert|Competition|Pageant|Showdown|Workshop|Exhibit|Fair|Carnival|Expo|Camp`

/**
 * Collect the most specific named event subjects and identifying hashtags from
 * evidence text. Used to keep child/sub-event facts bound to their subject when
 * prompt context must be truncated.
 */
export function extractSubjectScopeMarkers(text: string): string[] {
  if (typeof text !== 'string' || !text.trim()) return []
  const markers: string[] = []
  const seen = new Set<string>()
  const remember = (value: string) => {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) return
    const key = normalized.toLocaleLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    markers.push(normalized)
  }

  for (const match of text.matchAll(/#([\p{L}\p{N}][\p{L}\p{N}_-]{2,})/gu)) {
    const tag = match[1]
    if (GENERIC_SUBJECT_HASHTAGS.has(tag.toLocaleLowerCase())) continue
    if (!new RegExp(EVENT_KIND, 'i').test(tag.replace(/[_-]+/g, ' '))) continue
    remember(`#${tag}`)
  }

  const titled = new RegExp(
    String.raw`\b((?:[\p{Lu}][\p{L}\p{N}'’-]+\s+){0,6}(?:${EVENT_KIND})(?:\s+\d{4})?)\b`,
    'gu',
  )
  for (const match of text.matchAll(titled)) remember(match[1])

  return markers
}

function markerCoveredByText(marker: string, text: string): boolean {
  const haystack = text.toLocaleLowerCase()
  const raw = marker.replace(/^#/, '').toLocaleLowerCase()
  if (haystack.includes(raw)) return true
  const spaced = raw.replace(/[_-]+/g, ' ')
  if (haystack.includes(spaced)) return true
  const compact = raw.replace(/[\s_-]+/g, '')
  return compact.length >= 6 && haystack.replace(/[\s_-]+/g, '').includes(compact)
}

/**
 * Truncate evidence for the prompt without dropping the most specific subject
 * markers that bind venue/date/status facts to a named child or sub-event.
 */
export function truncatePreservingSubjectScope(text: string, maxLen: number): string {
  if (typeof text !== 'string') return ''
  if (!Number.isFinite(maxLen) || maxLen < 32) return text
  if (text.length <= maxLen) return text

  const markers = extractSubjectScopeMarkers(text)
  const headProbe = text.slice(0, maxLen)
  const missing = markers.filter((marker) => !markerCoveredByText(marker, headProbe))
  if (!missing.length) return `${text.slice(0, maxLen)}…`

  const suffix = `\n[Subject scope from source: ${missing.join(' | ')}]`
  const budget = Math.max(24, maxLen - suffix.length - 1)
  return `${text.slice(0, budget)}…${suffix}`
}

/**
 * Reusable Event AI Engine instruction: never broaden a child/sub-event fact to
 * the parent festival unless the evidence explicitly states that broader scope.
 */
export function buildSubjectScopeGuidance(): string {
  return [
    'SUBJECT SCOPE: A factual attribute or change (venue, date, status, fee, registration, cancellation) belongs to the most specific supported subject in the evidence.',
    'If evidence names a child or sub-event (camp, concert, parade, competition, pageant, booth, workshop, or similarly specific titled event), keep that subject in the answer.',
    'Do not promote a sub-event fact into a festival-wide claim unless the evidence explicitly states the whole festival changed.',
    'When subject scope is uncertain, keep the narrower wording or say the evidence does not clearly identify festival-wide scope.',
    'Summarize freely, but never broaden the factual subject beyond the evidence.',
  ].join(' ')
}

/**
 * Deterministic scope check for regression tests: true when the answer asserts a
 * parent-festival-wide attribute change while evidence only supports a more
 * specific named child/sub-event subject.
 */
export function doesAnswerBroadenSubjectScope(
  answer: string,
  evidence: string,
  parentFestivalName: string,
): boolean {
  if (typeof answer !== 'string' || typeof evidence !== 'string' || typeof parentFestivalName !== 'string') {
    return false
  }
  const parent = parentFestivalName.trim()
  if (!parent) return false

  const evidenceMarkers = extractSubjectScopeMarkers(evidence)
  const childMarkers = evidenceMarkers.filter((marker) => {
    const compact = marker.replace(/^#/, '').replace(/[\s_-]+/g, '').toLocaleLowerCase()
    const parentCompact = parent.replace(/[\s_-]+/g, '').toLocaleLowerCase()
    return compact.length > 0 && !parentCompact.includes(compact) && !compact.includes(parentCompact)
  })
  if (!childMarkers.length) return false

  const answerKeepsChild = childMarkers.some((marker) => markerCoveredByText(marker, answer))
  if (answerKeepsChild) return false

  const parentPattern = parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const festivalWideClaim = new RegExp(
    String.raw`\b(?:${parentPattern}|the\s+festival)\b.{0,80}\b(?:venue|location|moved|relocated|transferred|nausab)\b|\b(?:venue|location)\b.{0,80}\b(?:${parentPattern}|the\s+festival)\b`,
    'i',
  )
  return festivalWideClaim.test(answer)
}
