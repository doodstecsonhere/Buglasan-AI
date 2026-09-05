export type SupportedLanguage = 'en' | 'ceb' | 'fil'

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
  return evidence.sources.length > 0 || evidence.events.length > 0 || evidence.chunks.length > 0
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
