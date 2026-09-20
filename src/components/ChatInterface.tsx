import type { RefObject } from 'react'
import type { Message } from '../types'
import { MessageBubble } from './MessageBubble'
import { SourcesCard } from './SourcesCard'
import { TypingIndicator } from './TypingIndicator'
import { productConfig } from '../config/productConfig'
import type { FreshnessMetadata } from '../utils/freshness'

interface ChatInterfaceProps {
  messages: Message[]
  isLoading: boolean
  messagesEndRef: RefObject<HTMLDivElement | null>
  quickQuestions?: readonly string[]
  onSend?: (content: string) => void
}

function latestFreshnessDate(metadata: FreshnessMetadata | undefined): string | null {
  if (!metadata) return null
  const candidates = Object.values(metadata.evaluation.timestamps)
    .filter(timestamp => timestamp.timestamp && timestamp.formattedAt)
    .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
  return candidates[0]?.formattedAt ?? null
}

export function FreshnessIndicator({ metadata, isOnline }: { metadata?: FreshnessMetadata; isOnline: boolean }) {
  const date = latestFreshnessDate(metadata)
  // A quiet, secondary status line rather than an alert/banner. The timestamp
  // semantics are unchanged; only the visual weight is reduced.
  // Absence of a valid knowledge-update timestamp is visually silent: the line is
  // never replaced with an "unavailable"/"unknown" placeholder, especially while
  // an answer is loading, and no timestamp is ever fabricated.
  if (!date) return null
  return <p className="mb-3 px-0.5 text-xs font-medium leading-5 text-slate-400" role="status">
    Knowledge updated {date}.
    {!isOnline && <span className="ml-1">Newer information may exist online.</span>}
  </p>
}

export function ChatInterface({ messages, isLoading, messagesEndRef, isOnline = true, quickQuestions = [], onSend }: ChatInterfaceProps & { isOnline?: boolean }) {
  const latestMetadata = [...messages].reverse().find(message => message.role === 'assistant' && message.freshness)?.freshness
  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-content">
          <div className="empty-icon"><img src={productConfig.branding.appIconPath} alt="" aria-hidden="true" /></div>
          <p className="eyebrow">Ask with confidence</p>
          <h3 className="max-w-xl text-balance text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Your {productConfig.identity.festivalShortName} questions, answered with official sources.</h3>
          <p className="mt-3 max-w-lg text-sm leading-6 text-slate-500 sm:text-base">
            Ask about {productConfig.identity.festivalName}. I’ll look for official information and show you where each answer comes from.
          </p>
        </div>
        {quickQuestions.length > 0 && (
          <div className="suggestions w-full max-w-2xl" aria-label="Common questions">
            {quickQuestions.map(question => (
              <button key={question} type="button" onClick={() => onSend?.(question)} disabled={!onSend} className="suggestion disabled:opacity-50">{question}</button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 py-2">
      <FreshnessIndicator metadata={latestMetadata} isOnline={isOnline} />
      {messages.map((message, index) => (
        <div key={message.id} className="animate-fade-in">
            <MessageBubble
              message={message}
              showAvatar={index === 0 || messages[index - 1]?.role !== message.role}
            />
          
          {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
            <SourcesCard
              sources={message.sources}
            />
          )}
        </div>
      ))}
      
      {isLoading && <TypingIndicator />}
      
      <div ref={messagesEndRef} />
    </div>
  )
}
