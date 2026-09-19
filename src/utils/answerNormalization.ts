/**
 * Conservative, deterministic normalization for model-generated answer Markdown.
 *
 * This layer fixes ONLY known structural defects that leak out of generation:
 *   1. A sentence-ending punctuation mark glued to an opening bold phrase
 *      (`date.**So,**` / `tomorrow.**If**`).
 *   2. A recognized section heading glued to the previous paragraph or a
 *      citation (e.g. a trailing `---What this means for you`).
 *
 * It deliberately never rewrites arbitrary prose, never fabricates content, and
 * never touches citation numbering. Every transform is idempotent so repeated
 * renders produce identical output.
 */

/**
 * Phrases that the assistant uses as answer section labels. Matching is
 * capitalization-sensitive so ordinary prose that merely contains the words
 * ("here is what this means for you") is left untouched.
 */
export const KNOWN_ANSWER_SECTION_HEADINGS = [
  'What this means for you',
  'What the sources tell us',
] as const

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SECTION_HEADING_ALTERNATION = KNOWN_ANSWER_SECTION_HEADINGS.map(escapeRegExp).join('|')

// Canonical-case heading, optionally wrapped in bold delimiters. Case-sensitive:
// only the title-cased label (or its bolded form) is treated as a heading.
const SECTION_HEADING_PATTERN = new RegExp(`(\\*\\*)?(${SECTION_HEADING_ALTERNATION})(\\*\\*)?`, 'g')

const NEWLINE_RUN_END = /\n*$/
const NEWLINE_RUN_START = /^\n*/
const BOLD_SENTENCE_START = /([.!?\uFF01\uFF1F])(\*\*[A-Z])/g
const NON_SPACE_START = /^[^\s\n]/

/** Insert a space when sentence punctuation is glued directly to a bold sentence start. */
export function separatePunctuationFromBold(text: string): string {
  return text.replace(BOLD_SENTENCE_START, '$1 $2')
}

/**
 * Push a recognized section heading onto its own block by ensuring a blank line
 * precedes and follows it, without ever duplicating existing blank lines.
 */
export function isolateSectionHeadings(text: string): string {
  return text.replace(SECTION_HEADING_PATTERN, (match, open: string | undefined, phrase: string, close: string | undefined, offset: number, full: string) => {
    const before = full.slice(0, offset)
    const after = full.slice(offset + match.length)
    const token = `${open ?? ''}${phrase}${close ?? ''}`

    const beforeNewlines = before.match(NEWLINE_RUN_END)?.[0].length ?? 0
    const prefix = before.trim().length > 0
      ? (beforeNewlines >= 2 ? '' : beforeNewlines === 1 ? '\n' : '\n\n')
      : ''

    const afterNewlines = after.match(NEWLINE_RUN_START)?.[0].length ?? 0
    const suffix = NON_SPACE_START.test(after)
      ? (afterNewlines >= 2 ? '' : afterNewlines === 1 ? '\n' : '\n\n')
      : ''

    return prefix + token + suffix
  })
}

/**
 * Detect a standalone answer section heading line (already block-separated).
 * Accepts the canonical phrase with or without surrounding bold, tolerating a
 * trailing colon. Returns the display phrase or `null`.
 */
export function matchStandaloneSectionHeading(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const bold = trimmed.match(/^\*\*(.+?)\*\*:?\*?\*?$/)
  const candidate = (bold ? bold[1] : trimmed).replace(/:$/, '').trim()
  const lower = candidate.toLowerCase()
  return KNOWN_ANSWER_SECTION_HEADINGS.find((heading) => heading.toLowerCase() === lower) ?? null
}

/** Apply every conservative normalization pass in a stable order. */
export function normalizeAnswerMarkdown(text: string): string {
  if (!text) return text
  return isolateSectionHeadings(separatePunctuationFromBold(text))
}
