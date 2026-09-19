import type { Message, SourceCitation } from '../types'
import type { ElementType, ReactNode } from 'react'
import { formatRelativeTime } from '../utils/dateUtils'
import { trustedSourceUrl } from '../utils/chatThreads'
import { productConfig } from '../config/productConfig'
import type { AnswerWarning } from '../utils/freshness'

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
        {!isUser && message.freshness?.warning && message.freshness.warning !== 'NONE' && (
          <div role="note" className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
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
    case 'MIXED_FRESHNESS': return 'Some information used for this time-sensitive answer may be older than other sources.'
    case 'UNKNOWN_FRESHNESS': return 'Knowledge base could not confirm whether a newer update supersedes this time-sensitive answer.'
    default: return ''
  }
}

export function renderCitedContent(content: unknown, sources: unknown) {
  const safeSources = Array.isArray(sources) ? sources.filter((source): source is SourceCitation => !!source && typeof source === 'object' && typeof source.id === 'string' && typeof source.title === 'string') : []
  const rawContent = typeof content === 'string' && content.trim() ? content : 'Unable to display this message.'
  // Only the structured Evidence panel makes a trailing model-generated bibliography redundant.
  const safeContent = safeSources.length > 0 ? stripTrailingSourcesSection(rawContent) : rawContent
  const sourceById = new Map(safeSources.map((source) => [source.id, source]))
  const parts = safeContent.split(/(_\(src:\s*[a-zA-Z0-9_-]+\)_|\[Source\s+\d+\])/g)

  return parts.map((part, index) => {
    const idMatch = part.match(/^_\(src:\s*([a-zA-Z0-9_-]+)\)_$/)
    const numberMatch = part.match(/^\[Source\s+(\d+)\]$/)
    const source = idMatch
      ? sourceById.get(idMatch[1])
      : numberMatch
        ? safeSources[Number(numberMatch[1]) - 1]
        : undefined

    if (!source) return <span key={`${part}-${index}`}>{renderMarkdownText(part)}</span>
    return (
      <a
        key={`${source.id}-${index}`}
        href={trustedSourceUrl(source) ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-1 inline-flex align-super text-xs font-semibold text-brand-blue underline-offset-2 hover:underline"
        aria-label={`Open source: ${source.title}`}
        title={source.title}
      >
        [{safeSources.indexOf(source) + 1}]
      </a>
    )
  })
}

// Deterministic trailing-bibliography parser. A trailing block is only
// suppressed when every line of it is clearly bibliography decoration or a
// citation-mapped entry, so substantive prose (even under a heading that
// mentions sources) is never deleted.
const BIBLIOGRAPHY_HEADING_PATTERN = /^[^\w\s]*\s*(?:sources?|references?|citations?)\s*:?\s*$/i
const BIBLIOGRAPHY_ENTRY_PATTERN = /^(?:[-*+]|\d+[.)]\s+)?\s*(?:\[\s*Source\s+\d+\s*\]|_\(src: [a-zA-Z0-9_-]+\)_)(?:\s+[^\n]*?)?(?:\s+(?:https?:\/\/|fb\.me\/)[^\s<]*)?\s*$/i

export function stripTrailingSourcesSection(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let lastContentIndex = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) { lastContentIndex = index; break }
  }
  if (lastContentIndex < 0) return text.trim()

  // A bibliography ends with either its heading (header-only tail) or a citation entry line.
  const lastLine = lines[lastContentIndex].trim()
  const lastIsHeading = BIBLIOGRAPHY_HEADING_PATTERN.test(lastLine)
  if (!lastIsHeading && !BIBLIOGRAPHY_ENTRY_PATTERN.test(lastLine)) return text.trim()

  // Walk up over entry lines to locate the bibliography heading.
  let headingIndex = -1
  for (let index = lastIsHeading ? lastContentIndex : lastContentIndex - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (BIBLIOGRAPHY_HEADING_PATTERN.test(line)) { headingIndex = index; break }
    if (!BIBLIOGRAPHY_ENTRY_PATTERN.test(line)) return text.trim()
  }
  if (headingIndex < 0 || headingIndex === 0) return text.trim()

  const kept = lines.slice(0, headingIndex).join('\n').trim()
  return kept || text.trim()
}

/** Render the small Markdown subset generated by chat responses without parsing HTML. */
export function renderMarkdownText(text: string): ReactNode[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const lines = normalized.split('\n')
  const output: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/)
    if (headingMatch) {
      const level = Math.min(6, Math.max(1, line.match(/^#+/)?.[0].length ?? 1))
      const HeadingTag = `h${level}` as ElementType
      output.push(<HeadingTag key={`heading-${index}`}>{renderInlineMarkdown(headingMatch[1])}</HeadingTag>)
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
            <li key={`li-${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      )
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
            <li key={`ol-${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && !/^#{1,6}\s+/.test(lines[index].trim()) && !/^[-*]\s+/.test(lines[index].trim()) && !/^\d+\.\s+/.test(lines[index].trim()) && lines[index].trim() !== '') {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    const paragraphText = paragraphLines.join(' ')
    if (paragraphText) output.push(...renderInlineMarkdown(paragraphText))
  }

  return output
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const inlineText = text.replace(/\n+/g, ' ').trim()
  if (!inlineText) return []

  return inlineText.split(/(\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*)|https?:\/\/[^\s<]+)/g).map((part, index) => {
    if (!part) return null
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
