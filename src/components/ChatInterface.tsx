import type { RefObject } from 'react'
import type { Message } from '../types'
import { MessageBubble } from './MessageBubble'
import { SourcesCard } from './SourcesCard'
import { TypingIndicator } from './TypingIndicator'

interface ChatInterfaceProps {
  messages: Message[]
  isLoading: boolean
  festivalYear: number
  messagesEndRef: RefObject<HTMLDivElement | null>
}

export function ChatInterface({ messages, isLoading, festivalYear, messagesEndRef }: ChatInterfaceProps) {
  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <svg className="w-8 h-8 text-fiesta-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
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
            festivalYear={festivalYear}
              showAvatar={index === 0 || messages[index - 1]?.role !== message.role}
            />
          
          {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
            <SourcesCard 
              sources={message.sources} 
              festivalYear={festivalYear}
            />
          )}
        </div>
      ))}
      
      {isLoading && <TypingIndicator />}
      
      <div ref={messagesEndRef} />
    </div>
  )
}
