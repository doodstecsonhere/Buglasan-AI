import { useState, type FormEvent } from 'react'
import { sendChatMessage, ChatError } from '../services'
import type { ChatLanguage } from '../types'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const QUICK_QUESTIONS = [
  'What events are happening today?',
  'What events are happening tomorrow?',
  'When is the Hara sa Negros Oriental competition?',
  'Where is the Buglasan Trade Fair?',
  'What happens on October 16?',
]

export function ChatTab({ language }: { language: ChatLanguage }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async (content: string) => {
    if (!content.trim() || isLoading) return
    setError(null)
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: content.trim() }
    const history = [...messages, userMessage]
    setMessages(history)
    setInput('')
    setIsLoading(true)
    try {
      const response = await sendChatMessage({
        message: content,
        language,
        conversationHistory: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
      })
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: response.reply }])
    } catch (err) {
      const msg = err instanceof ChatError ? err.message : 'Something went wrong. Please try again.'
      setError(msg)
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: msg }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (input.trim() && !isLoading) {
      handleSend(input)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-2xl">
          {messages.length === 0 ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
              <h2 className="text-xl font-bold text-navy-900">Ask about the Buglasan Festival 2026</h2>
              <p className="text-sm text-slate-600">Get answers about events, venues, schedules, and more.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_QUESTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => handleSend(q)}
                    disabled={isLoading}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-navy-400 hover:text-navy-700 disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                      m.role === 'user'
                        ? 'bg-navy-700 text-white'
                        : 'bg-white text-slate-800 shadow-sm border border-slate-200'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-white px-4 py-3 shadow-sm border border-slate-200">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '0ms' }} />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '150ms' }} />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl items-end gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={isLoading}
            placeholder="Ask about the festival..."
            maxLength={500}
            className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="h-12 w-12 shrink-0 rounded-xl bg-navy-700 text-white text-lg font-bold transition hover:bg-navy-800 disabled:opacity-40"
            aria-label="Send message"
          >
            ↑
          </button>
        </form>
        {error && <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}
