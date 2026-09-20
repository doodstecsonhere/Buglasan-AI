import type { Message, SourceCitation } from '../types'
import type { ElementType, ReactNode } from 'react'
import { formatRelativeTime } from '../utils/dateUtils'
import { trustedSourceUrl } from '../utils/chatThreads'
import { productConfig } from '../config/productConfig'
import type { AnswerWarning } from '../utils/freshness'
import { matchStandaloneSectionHeading, normalizeAnswerMarkdown } from '../utils/answerNormalization'

interface MessageBubbleProps {
  message: Message
  showAvatar: boolean
}

export function MessageBubble({ message, showAvatar }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const timeString = message.timestamp instanceof Date && !Number.isNaN(message.timestamp.getTime()) ? formatRelativeTime(message.timestamp) : 'just now'
  
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && showAvatar && (
        <img className="message-avatar" src={productConfig.branding.assistantAvatarPath} alt={productConfig.branding.assistantAvatarAlt} />
      )}
      
      <div className={`max-w-[80%] ${isUser ? 'order-2' : 'order-1'}`}>
        {!isUser && message.freshness?.warning && warningTone(message.freshness.warning) === 'warning' && (
          <div role="note" className={warningToneClass(message.freshness.warning)}>
            {warningCopy(message.freshness.warning)}
          </div>
        )}
        <div
          className={`
            max-w-full break-words px-4 py-3 text-sm leading-7 whitespace-pre-wrap
            ${isUser
              ? 'rounded-2xl rounded-br-md bg-brand-blue text-white shadow-md shadow-blue-100'
              : 'rounded-2xl rounded-bl-md border border-slate-200/80 bg-white text-neutral-900 shadow-sm'
            }
          `}
        >
          {renderCitedContent(message.content, message.sources ?? [])}
        </div>
        
        <div className={`mt-1 flex items-center gap-1.5 text-[11px] text-neutral-400 ${isUser ? 'justify-end pr-1' : 'justify-start pl-1'}`}>
          <span>{timeString}</span>
        </div>
      </div>
      
      {isUser && showAvatar && (
        <div className="message-avatar user-avatar" aria-hidden="true">You</div>
      )}
    </div>
  )
}

export function warningCopy(warning: AnswerWarning): string {
  switch (warning) {
    case 'STALE_SOURCE': return 'This time-sensitive answer relies on older source information. Verify the cited source for the latest update.'
    case 'STALE_CORPUS': return 'This time-sensitive answer could not be confirmed against a current knowledge base.'
    case 'MIXED_FRESHNESS': return 'This answer draws on sources updated at different times. The most recent official source is listed in Evidence.'
    case 'UNKNOWN_FRESHNESS': return 'This is the latest information in the Buglasan AI knowledge base. A newer official update may exist if it has not yet been added.'
    default: return ''
  }
}

/**
 * A genuine staleness concern (STALE_SOURCE / STALE_CORPUS) is shown as a warning.
 * Ordinary freshness uncertainty is only informational and must not alarm the reader
 * or imply that Buglasan AI monitors official sources live.
 */
export type WarningTone = 'warning' | 'info'

export function warningTone(warning: AnswerWarning): WarningTone {
  return warning === 'STALE_SOURCE' || warning === 'STALE_CORPUS' ? 'warning' : 'info'
}

export function warningToneClass(warning: AnswerWarning): string {
  const base = 'mb-2 rounded-lg border px-3 py-2 text-xs leading-5'
  return warningTone(warning) === 'warning'
    ? `${base} border-amber-200 bg-amber-50 text-amber-900`
    : `${base} border-sky-100 bg-sky-50 text-sky-900`
}

// Inline citation syntax. Supports ASCII brackets ([Source 1]) and the full-width
// 【】 brackets some models emit, plus any Unicode whitespace between tokens
// (NBSP, thin/nap/narrow-no-break spaces, ideographic space).
const CITE_WS = '[\\s\\u00A0\\u2000-\\u200B\\u202F\\u205F\\u3000]'
const CITE_OPEN = '[\\u3010[]'
const CITE_CLOSE = '[\\u3011\\]]'
const CITATION_TOKEN_SOURCE = `${CITE_OPEN}${CITE_WS}*Source${CITE_WS}+\\d+(?:${CITE_WS}*(?:,|&|\\band\\b)${CITE_WS}*(?:${CITE_WS}*Source${CITE_WS}*)?\\d+)*${CITE_WS}*${CITE_CLOSE}`
const CITATION_SPLIT_RE = new RegExp(`(_\\(src:\\s*[a-zA-Z0-9_-]+\\)_|${CITATION_TOKEN_SOURCE})`, 'gi')
const CITATION_TOKEN_RE = new RegExp(`^${CITATION_TOKEN_SOURCE}$`, 'i')

export function renderCitedContent(content: unknown, sources: unknown) {
  const safeSources = Array.isArray(sources) ? sources.filter((source): source is SourceCitation => !!source && typeof source === 'object' && typeof source.id === 'string' && typeof source.title === 'string') : []
  const rawContent = typeof content === 'string' && content.trim() ? content : 'Unable to display this message.'
  // Deterministically repair known structural defects before any parsing.
  const normalizedContent = normalizeAnswerMarkdown(rawContent)
  // Only the structured Evidence panel makes a trailing model-generated bibliography redundant.
  const safeContent = safeSources.length > 0 ? stripTrailingSourcesSection(normalizedContent, safeSources) : normalizedContent
  const sourceById = new Map(safeSources.map((source) => [source.id, source]))
  // A single "[Source N]" or a compound "[Source 2, Source 3]" / "[Source 2 and 3]"
  // reference is captured whole, in ASCII brackets or the full-width 【】 brackets
  // some models emit (with any Unicode whitespace inside). The group is anchored on
  // the literal "Source" keyword so unrelated bracketed text ("[Note 1]", "[2]",
  // "【Note 1】") is never transformed.
  const parts = safeContent.split(CITATION_SPLIT_RE)

  return parts.flatMap((part, index) => {
    const idMatch = part.match(/^_\(src:\s*([a-zA-Z0-9_-]+)\)_$/)
    if (idMatch) {
      const source = sourceById.get(idMatch[1])
      if (source) return [citationAnchor(source, safeSources, `${source.id}-${index}`)]
      return [<span key={`${part}-${index}`}>{renderMarkdownText(part, safeSources)}</span>]
    }

    if (part && CITATION_TOKEN_RE.test(part)) {
      const resolved = (part.match(/\d+/g) ?? [])
        .map((value) => safeSources[Number(value) - 1])
        .filter((source): source is SourceCitation => !!source)
      if (resolved.length === 0) return [<span key={`${part}-${index}`}>{renderMarkdownText(part, safeSources)}</span>]
      if (resolved.length === 1) return [citationAnchor(resolved[0], safeSources, `${resolved[0].id}-${index}`)]
      return [(<span key={`compound-${index}`} className="ml-1 inline-flex align-super gap-1 text-xs font-semibold text-brand-blue">{resolved.map((source, sourceIndex) => citationAnchor(source, safeSources, `${source.id}-${index}-${sourceIndex}`, false))}</span>)]
    }

    return [<span key={`${part}-${index}`}>{renderMarkdownText(part, safeSources)}</span>]
  })
}

function citationAnchor(source: SourceCitation, evidence: readonly SourceCitation[], key: string, withLeftMargin = true) {
  return (
    <a
      key={key}
      href={trustedSourceUrl(source) ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={`${withLeftMargin ? 'ml-1 ' : ''}inline-flex items-center align-super text-xs font-semibold text-brand-blue underline-offset-2 hover:underline`}
      aria-label={`Open source: ${source.title}`}
      title={source.title}
    >
      [{evidence.indexOf(source) + 1}]
    </a>
  )
}

// Deterministic trailing-bibliography parser. A trailing block is suppressed when
// every line of it is clearly bibliography decoration or a citation/list entry, and
// either an entry's marker maps onto a structured Evidence source, or the block sits
// under a strongly-decorated Sources heading (---, ##, ** or emoji) that is unmistakably
// bibliography. Substantive prose (even under a heading that mentions sources) and lists
// with unrelated or bare "Sources:" lead-ins are never deleted, and answer content before
// the bibliography is always retained.
const BIBLIOGRAPHY_HEADING_PATTERN = /^(?:[-*+_]{2,}|[^\w\s]*)\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:sources?|references?|citations?)\s*:?(?:\*\*|__)?\s*$/i
const BIBLIOGRAPHY_SEPARATOR_PATTERN = /^[-*_]{3,}$/
const BIBLIOGRAPHY_ENTRY_PATTERN = /^(?:(?:[-*+]|\d+[.)])\s*)?(?:\[\s*Source\s+\d+\s*\]|_\(src: [a-zA-Z0-9_-]+\)_|\[\d+\][^\s\]])[^\n]*(?:\s+(?:https?:\/\/|fb\.me\/)[^\s<]*)?\s*$/i
const BIBLIOGRAPHY_LIST_ENTRY_PATTERN = /^(?:[-*+]|\d+[.)])[ \t]*\S/
// Markdown-link bibliography shapes such as `-[**[1]**](url)Facebook post …`.
const BIBLIOGRAPHY_LINK_ENTRY_PATTERN = /^(?:(?:[-*+]|\d+[.)])[ \t]*)?(?:\[\*{2}\[\s*(?:Source\s+)?\d+\s*\]\*{2}\]|\[[^\]]*\d[^\]]*\])[ \t]*\([^)]*\).*$/i
// A leading citation marker proves a link-shaped line really is a bibliography entry.
const LEADING_CITATION_MARKER_PATTERN = /^(?:(?:[-*+]|\d+[.)])[ \t]*)?\[\*{0,2}\[?\s*(?:Source\s+)?(\d+)\s*\]?\*{0,2}\]/i
const BIBLIOGRAPHY_TRAILING_CITATION_PATTERN = /\s(?:[-\u2013\u2014])\s+\[\s*(?:Source\s+)?\d+\s*\]\s*$/i
const BIBLIOGRAPHY_CITATION_MARKER_PATTERN = /\[\s*(?:Source\s+)?(\d+)\s*\]|_\(src:\s*([a-zA-Z0-9_-]+)\)_/gi
// A heading is "strong" when decorated before the sources word: a thematic rule
// (---/***), an ATX heading (#), bold (**/__), or a leading non-word glyph (emoji).
const STRONG_BIBLIOGRAPHY_HEADING_PATTERN = /^(?:[-*+_=~]{2,}|#{1,6}\s|\*\*|__)|^[^\w\s]/

function isStrongBibliographyHeading(line: string): boolean {
  return STRONG_BIBLIOGRAPHY_HEADING_PATTERN.test(line.trim())
}

function isBibliographyEntryLine(line: string): boolean {
  return BIBLIOGRAPHY_ENTRY_PATTERN.test(line) || BIBLIOGRAPHY_LINK_ENTRY_PATTERN.test(line) || BIBLIOGRAPHY_TRAILING_CITATION_PATTERN.test(line) || BIBLIOGRAPHY_LIST_ENTRY_PATTERN.test(line)
}

function bibliographyEntryReferencesEvidence(line: string, evidence: readonly SourceCitation[]): boolean {
  for (const marker of line.matchAll(BIBLIOGRAPHY_CITATION_MARKER_PATTERN)) {
    if (marker[2] !== undefined) {
      if (evidence.some((source) => source.id === marker[2])) return true
      continue
    }
    const position = Number(marker[1]) - 1
    if (Number.isInteger(position) && position >= 0 && position < evidence.length) return true
  }
  const leading = line.trim().match(LEADING_CITATION_MARKER_PATTERN)
  if (leading) {
    const position = Number(leading[1]) - 1
    if (Number.isInteger(position) && position >= 0 && position < evidence.length) return true
  }
  return false
}

export function stripTrailingSourcesSection(text: string, evidence: readonly SourceCitation[] = []): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let lastContentIndex = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) { lastContentIndex = index; break }
  }
  if (lastContentIndex < 0) return text.trim()

  // A bibliography ends with either its heading (header-only tail) or a citation entry line.
  const lastLine = lines[lastContentIndex].trim()
  const lastIsHeading = BIBLIOGRAPHY_HEADING_PATTERN.test(lastLine)
  const lastIsEntry = !lastIsHeading && isBibliographyEntryLine(lastLine)
  if (!lastIsHeading && !lastIsEntry) return text.trim()

  // Walk up over entry lines to locate the bibliography heading.
  let headingIndex = -1
  let entryCount = 0
  for (let index = lastIsHeading ? lastContentIndex : lastContentIndex - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (BIBLIOGRAPHY_HEADING_PATTERN.test(line)) { headingIndex = index; break }
    if (BIBLIOGRAPHY_SEPARATOR_PATTERN.test(line)) continue
    if (isBibliographyEntryLine(line)) { entryCount += 1; continue }
    return text.trim()
  }
  if (headingIndex < 0 || headingIndex === 0) return text.trim()

  // Safety signal: suppress when a bibliography citation maps to a structured Evidence
  // source, or when the block sits under an unmistakably-decorated Sources heading whose
  // entries are all list-shaped. Bare "Sources:" lead-ins without decoration are kept.
  if (entryCount > 0 && !isStrongBibliographyHeading(lines[headingIndex])) {
    let referencesEvidence = false
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (!line || BIBLIOGRAPHY_SEPARATOR_PATTERN.test(line) || BIBLIOGRAPHY_HEADING_PATTERN.test(line)) continue
      if (bibliographyEntryReferencesEvidence(line, evidence)) { referencesEvidence = true; break }
    }
    if (!referencesEvidence) return text.trim()
  }

  // Swallow a decorative rule that sits above the bibliography boundary, even when
  // normalization pushed it onto its own line with a blank between it and the heading
  // ("---\n\n**Sources**"). Blank lines are neutral; the walk stops at real content.
  let boundaryIndex = headingIndex
  for (let index = headingIndex - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (BIBLIOGRAPHY_SEPARATOR_PATTERN.test(line)) { boundaryIndex = index; continue }
    break
  }
  if (boundaryIndex === 0) return text.trim()

  const kept = lines.slice(0, boundaryIndex).join('\n').trim()
  return kept || text.trim()
}

/** Render the small Markdown subset generated by chat responses without parsing HTML. */
export function renderMarkdownText(text: string, evidence: readonly SourceCitation[] = []): ReactNode[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const lines = normalized.split('\n')
  const output: ReactNode[] = []
  let index = 0
  // The bubble renders with `whitespace-pre-wrap`, so a blank-line text node is what
  // keeps one paragraph block visibly separated from the next after normalization
  // pushed a glued heading or source note onto its own line.
  let insideInlineBlock = false

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    const sectionHeading = matchStandaloneSectionHeading(line)
    if (sectionHeading) {
      output.push(<h4 key={`section-${index}`} className="answer-section-heading">{sectionHeading}</h4>)
      insideInlineBlock = false
      index += 1
      continue
    }

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/)
    if (headingMatch) {
      const level = Math.min(6, Math.max(1, line.match(/^#+/)?.[0].length ?? 1))
      const HeadingTag = `h${level}` as ElementType
      output.push(<HeadingTag key={`heading-${index}`}>{renderInlineMarkdown(headingMatch[1], evidence)}</HeadingTag>)
      insideInlineBlock = false
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''))
        index += 1
      }
      output.push(
        <ul key={`list-${index}`} className="list-disc pl-5">
          {items.map((item, itemIndex) => (
            <li key={`li-${index}-${itemIndex}`}>{renderInlineMarkdown(item, evidence)}</li>
          ))}
        </ul>
      )
      insideInlineBlock = false
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }
      output.push(
        <ol key={`olist-${index}`} className="list-decimal pl-5">
          {items.map((item, itemIndex) => (
            <li key={`ol-${index}-${itemIndex}`}>{renderInlineMarkdown(item, evidence)}</li>
          ))}
        </ol>
      )
      insideInlineBlock = false
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && !/^#{1,6}\s+/.test(lines[index].trim()) && !/^[-*]\s+/.test(lines[index].trim()) && !/^\d+\.\s+/.test(lines[index].trim()) && !matchStandaloneSectionHeading(lines[index].trim()) && lines[index].trim() !== '') {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    const paragraphText = paragraphLines.join(' ')
    if (paragraphText) {
      if (insideInlineBlock) output.push('\n\n')
      output.push(...renderInlineMarkdown(paragraphText, evidence))
      insideInlineBlock = true
    }
  }

  return output
}

// Inline Markdown link syntax, including a label that carries its own bracket pair
// (`[**[1]**](https://…)`), which is how several models emit source citations.
const MARKDOWN_LINK_PATTERN = /^\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(([^)\s]*)\)$/
const MARKDOWN_LINK_SPLIT = /(\[(?:[^\[\]]|\[[^\[\]]*\])*\]\([^)\s]*\)|\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*)|https?:\/\/[^\s<]+)/g
const MARKDOWN_LINK_CITATION_LABEL = /^\*{0,2}\[\s*(?:Source\s+)?(\d+)\s*\]\*{0,2}$/i

function renderInlineMarkdown(text: string, evidence: readonly SourceCitation[] = []): ReactNode[] {
  const inlineText = text.replace(/\n+/g, ' ').trim()
  if (!inlineText) return []

  return inlineText.split(MARKDOWN_LINK_SPLIT).map((part, index) => {
    if (!part) return null
    const link = part.match(MARKDOWN_LINK_PATTERN)
    if (link) {
      const [, label, rawUrl] = link
      const citation = label.match(MARKDOWN_LINK_CITATION_LABEL)
      // A citation-shaped label resolves against the structured Evidence list, so the
      // link always points at the trusted source rather than model-written markup.
      if (citation) {
        const source = evidence[Number(citation[1]) - 1]
        if (source) return citationAnchor(source, evidence, `citation-link-${index}`)
        return <span key={`citation-inert-${index}`}>{renderSafeLinks(label, `citation-inert-${index}`)}</span>
      }
      if (isSafeHttpUrl(rawUrl)) {
        return <a key={`link-${index}`} href={rawUrl} target="_blank" rel="noopener noreferrer" className="text-brand-blue underline underline-offset-2 hover:text-blue-800">{renderSafeLinks(label, `link-label-${index}`)}</a>
      }
      return <span key={`link-inert-${index}`}>{renderSafeLinks(label, `link-inert-${index}`)}</span>
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`bold-${index}`}>{renderSafeLinks(part.slice(2, -2), `bold-${index}`)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={`italic-${index}`}>{renderSafeLinks(part.slice(1, -1), `italic-${index}`)}</em>
    }
    return renderSafeLinks(part, `text-${index}`)
  }).filter((part): part is ReactNode => part !== null)
}

/** Render valid http(s) URLs as links without parsing or injecting HTML. */
export function renderSafeLinks(text: string, keyPrefix = 'url'): ReactNode | ReactNode[] {
  if (!/(https?:\/\/[^\s<]+)/.test(text)) return text
  return text.split(/(https?:\/\/[^\s<]+)/g).map((part, index) => {
    if (index % 2 === 0) return part
    const match = part.match(/^(.*?)([.,!?;:]+)?$/)
    const candidate = match?.[1] ?? part
    const punctuation = match?.[2] ?? ''
    if (!isSafeHttpUrl(candidate)) return part
    return <span key={`${keyPrefix}-${index}`}><a href={candidate} target="_blank" rel="noopener noreferrer" className="text-brand-blue underline underline-offset-2 hover:text-blue-800">{candidate}</a>{punctuation}</span>
  })
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname
  } catch {
    return false
  }
}
