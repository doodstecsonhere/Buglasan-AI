import type { RefObject } from 'react'
import type { Message } from '../types'
import { MessageBubble } from './MessageBubble'
import { SourcesCard } from './SourcesCard'
import { TypingIndicator } from './TypingIndicator'

interface ChatInterfaceProps {
  messages: Message[]
  isLoading: boolean
  messagesEndRef: RefObject<HTMLDivElement | null>
}

export function ChatInterface({ messages, isLoading, messagesEndRef }: ChatInterfaceProps) {
  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><img src="/icons/icon-192.png" alt="" aria-hidden="true" /></div>
        <p className="eyebrow">Ask with confidence</p>
        <h3 className="text-2xl font-bold tracking-tight text-slate-950">Your Buglasan questions,<br className="sm:hidden" /> answered with official sources.</h3>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
          Ask about Buglasan Festival. I’ll look for official information and show you where each answer comes from.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 py-2">
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
