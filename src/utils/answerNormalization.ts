/**
 * Conservative, deterministic normalization for model-generated answer Markdown.
 *
 * This layer fixes ONLY known structural defects that leak out of generation:
 *   1. A sentence-ending punctuation mark glued to an opening bold phrase
 *      (`date.**So,**` / `tomorrow.**If**`).
 *   2. A bold answer heading glued to the sentence that follows it
 *      (`**Buglasan Festival 2026 – End Date**The 2026 …`).
 *   3. An italicised source/note sentence glued to the text around it or to the
 *      citation that follows it (`…2026.*Source: …*[**[1]**](url)`).
 *   4. A recognized section heading glued to the previous paragraph or a
 *      citation (e.g. a trailing `---What this means for you`).
 *   5. A trailing bibliography that was emitted with its separators, heading and
 *      entries collapsed onto one line (`…)---**Sources** -[**[1]**](url)Post`),
 *      which the line-based suppressor can only see once the parts are separated.
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

/** A bold run whose closing delimiter is glued to a following capital or digit. */
const BOLD_HEADING_GLUE = /(\*\*[^*\n]{2,120}?[^.,;:!?\s*]\*\*)([A-Z0-9\uFF10-\uFF19])/g

/** Insert a space when sentence punctuation is glued directly to a bold sentence start. */
export function separatePunctuationFromBold(text: string): string {
  return text.replace(BOLD_SENTENCE_START, '$1 $2')
}

/**
 * Push a bold heading that was emitted without its trailing whitespace onto its
 * own block. Only a run that ends in a word character and is immediately followed
 * by a capital or a digit (a new sentence) is touched, so mid-sentence emphasis
 * such as `**So,** that settles it` or `**5** minutes` is left alone.
 */
export function separateBoldHeadingFromBody(text: string): string {
  return text.replace(BOLD_HEADING_GLUE, '$1\n\n$2')
}

// A single-asterisk italic run: neither delimiter may belong to a `**` pair, and the
// content holds no asterisk, so it closes on the first `*` after the opening one.
const ITALIC_RUN = /(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g
const SOURCE_NOTE_LABEL = /^\s*(?:sources?|notes?|references?|disclaimer|update)\b/i
const INLINE_TEXT_BEFORE = /[^\s\n]$/
const CITATION_OPEN_START = /^[\u3010[]/

/**
 * Give an italicised source note its own block, and never let an italic run sit
 * flush against a citation that follows it. Ordinary emphasis inside prose is
 * untouched unless one of those two boundaries is glued.
 */
export function separateEmphasisBoundaries(text: string): string {
  return text.replace(ITALIC_RUN, (match, inner: string, offset: number, full: string) => {
    const before = full.slice(0, offset)
    const after = full.slice(offset + match.length)
    const gluedCitationAfter = CITATION_OPEN_START.test(after) ? ' ' : ''
    if (SOURCE_NOTE_LABEL.test(inner) && INLINE_TEXT_BEFORE.test(before)) {
      const newlineRun = NEWLINE_RUN_END.exec(before)?.[0].length ?? 0
      const prefix = newlineRun >= 2 ? '' : newlineRun === 1 ? '\n' : '\n\n'
      return prefix + match + gluedCitationAfter
    }
    return match + gluedCitationAfter
  })
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

// ---------------------------------------------------------------------------
// Collapsed trailing bibliography
//
// Generation sometimes emits the whole source list with no newlines at all, so a
// line-based suppressor cannot see its shape. These passes put the pieces back on
// their own lines. Each pass consumes only the boundary it inserts — everything it
// matches after the boundary is a lookahead — which is what keeps the result
// identical when the passes are applied a second time.
// ---------------------------------------------------------------------------
const BIB_RULE = '(?:-{3,}|={3,})'
// An inline bibliography bullet. `*` is deliberately excluded: an asterisk that is
// glued to the text before it is far more often the closing delimiter of an italic
// source note than a collapsed list bullet, and models emit `-` for these tails.
const BIB_LIST_MARKER = '(?:[-+]|\\d+[.)])'
// The citation marker of a bibliography entry. Only decorated shapes count: an
// undecorated `[1]` also occurs inside prose, and a plain inline `[Source 1]`
// belongs to the sentence before it rather than to a new entry.
const BIB_CITATION = `(?:\\[\\*\\*\\[\\s*(?:Source\\s+)?\\d+\\s*\\]\\*\\*\\]|\\[\\*\\*\\s*(?:Source\\s+)?\\d+\\s*\\*\\*\\]|\\[\\*\\*(?:Source\\s+)?\\d+\\*\\*\\]|(?<![*\\[])\\[\\s*(?:Source\\s+)?\\d+\\s*\\](?![\\d*])|\\u3010\\s*(?:Source\\s+)?\\d+\\s*\\u3011|_\\(src:[ \\t]*[a-zA-Z0-9_-]+\\)_)`
const BIB_HEAD_WORD = '(?:Sources|References|Citations)'
// A bibliography heading, with or without its decorative rule, optionally followed
// by the first entry on the same line.
const BIB_HEAD = `(?:\\*\\*|__)(?:[ \\t]*${BIB_HEAD_WORD})[ \\t]*:?(?:\\*\\*|__)[ \\t]*|^#{1,6}[ \\t]*${BIB_HEAD_WORD}\\b(?:[ \\t]*:?[ \\t]*(?:\\*\\*|__))?[ \\t]*|^${BIB_HEAD_WORD}\\b[ \\t]*:(?:[ \\t]*\\*\\*)?`
const BIB_TAIL_IS_BIBLIOGRAPHY = `(?:(?:${BIB_HEAD}|${BIB_RULE}[ \\t]*(?:\\*\\*|__|#{1,6}[ \\t]*)?${BIB_HEAD_WORD}\\b)[\\s\\S]*$|${BIB_LIST_MARKER}[ \\t]*${BIB_CITATION})`
const BIB_RULE_BEFORE_HEADING = new RegExp(`([^\\n\\s])[ \\t]*(${BIB_RULE})(?=[ \\t]*(?:\\*\\*|__)[ \\t]*${BIB_HEAD_WORD}\\b)`, 'gi')
const BIB_HEAD_AFTER_RULE = new RegExp(`(${BIB_RULE})[ \\t]*(?=(?:\\*\\*|__)[ \\t]*${BIB_HEAD_WORD}\\b)`, 'gi')
const BIB_GLUED_HEADING = new RegExp(`([^\\n\\s])[ \\t]*(?=${BIB_HEAD}${BIB_TAIL_IS_BIBLIOGRAPHY})`, 'gi')
const BIB_GLUED_ENTRY = new RegExp(`([^\\n\\s])[ \\t]*(?=${BIB_LIST_MARKER}[ \\t]*${BIB_CITATION})`, 'gi')

/**
 * Restore the line structure a trailing bibliography is supposed to have when
 * generation collapsed its rule, heading and entries onto a single line. Only
 * bibliography-shaped markup is split, so ordinary prose is never re-flowed.
 */
export function separateInlineBibliography(text: string): string {
  return text
    .replace(BIB_RULE_BEFORE_HEADING, (_match, head: string, rule: string) => `${head}\n\n${rule}\n\n`)
    .replace(BIB_HEAD_AFTER_RULE, (_match, rule: string) => `${rule}\n\n`)
    .replace(BIB_GLUED_HEADING, (_match, head: string) => `${head}\n\n`)
    .replace(BIB_GLUED_ENTRY, (_match, head: string) => `${head}\n\n`)
}

/** Apply every conservative normalization pass in a stable order. */
export function normalizeAnswerMarkdown(text: string): string {
  if (!text) return text
  return separateInlineBibliography(isolateSectionHeadings(separateEmphasisBoundaries(separateBoldHeadingFromBody(separatePunctuationFromBold(text)))))
}
