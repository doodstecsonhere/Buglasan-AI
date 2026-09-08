import { useState, useEffect, useRef, useCallback } from 'react'
import { ChatInterface } from './components/ChatInterface'
import { FacebookBadge } from './components/FacebookBadge'
import { ChatHistoryDrawer } from './components/ChatHistoryDrawer'
import { AIDisclaimer } from './components/AIDisclaimer'
import type { Message } from './types'
import { getCurrentFestivalYear } from './utils/dateUtils'
import { demoMessages, demoQuickQuestions } from './data/demoData'
import { chatService } from './services'
import { createChatThread, loadChatThreads, saveChatThreads, titleFromMessages, type ChatThread } from './utils/chatThreads'

function App() {
  const festivalYear = getCurrentFestivalYear()
  const [threads, setThreads] = useState<ChatThread[]>(() => loadChatThreads())
  const [activeThreadId, setActiveThreadId] = useState(() => loadChatThreads()[0]?.id ?? '')
  const [messages, setMessages] = useState<Message[]>(() => loadChatThreads()[0]?.messages ?? demoMessages)
  const [isLoading, setIsLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeThreadRef = useRef(activeThreadId)

  useEffect(() => { saveChatThreads(threads) }, [threads])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const persistMessages = useCallback((nextMessages: Message[]) => {
    setMessages(nextMessages)
    setThreads(previous => {
      const currentId = activeThreadRef.current
      const existing = previous.find(thread => thread.id === currentId)
      const next = existing
        ? previous.map(thread => thread.id === currentId ? { ...thread, messages: nextMessages, title: titleFromMessages(nextMessages), updatedAt: new Date().toISOString() } : thread)
        : [createChatThread(nextMessages), ...previous]
      if (!existing && next[0]) { activeThreadRef.current = next[0].id; setActiveThreadId(next[0].id) }
      return next
    })
  }, [])

  const handleSendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: content.trim(), timestamp: new Date() }
    const history = [...messages, userMessage]
    persistMessages(history)
    setIsLoading(true)
    try {
      const language = getPreferredChatLanguage()
      const response = await chatService.sendMessage({ message: content, festivalYear, language, conversationHistory: messages.slice(-6).map(m => ({ ...m, timestamp: m.timestamp.toISOString() })) })
      persistMessages([...history, { id: response.message.id, role: 'assistant', content: response.message.content, timestamp: new Date(response.message.timestamp), sources: response.message.sources, festivalYear: response.message.festivalYear, claimCitations: response.message.claimCitations }])
    } catch (error) {
      console.error('Chat error:', error)
      persistMessages([...history, { id: crypto.randomUUID(), role: 'assistant', content: 'Sorry, I encountered an error. Please try again or check the official Buglasan Festival Facebook Page for the latest information.', timestamp: new Date(), festivalYear }])
    } finally { setIsLoading(false) }
  }, [festivalYear, isLoading, messages, persistMessages])

  const newChat = useCallback(() => { activeThreadRef.current = ''; setActiveThreadId(''); setMessages([]); setHistoryOpen(false) }, [])
  const selectThread = useCallback((id: string) => { const thread = threads.find(item => item.id === id); if (thread) { activeThreadRef.current = id; setActiveThreadId(id); setMessages(thread.messages); setHistoryOpen(false) } }, [threads])
  const deleteThread = useCallback((id: string) => { setThreads(previous => previous.filter(thread => thread.id !== id)); if (id === activeThreadId) newChat() }, [activeThreadId, newChat])

  return <div className="min-h-screen bg-neutral-50 text-slate-900">
    <FacebookBadge />
    <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-7xl">
      <ChatHistoryDrawer threads={threads} activeThreadId={activeThreadId} open={historyOpen} onClose={() => setHistoryOpen(false)} onNew={newChat} onSelect={selectThread} onDelete={deleteThread} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-neutral-200 bg-white/90 px-4 py-4 backdrop-blur sm:px-6"><div className="mx-auto flex max-w-3xl items-center justify-between"><div className="flex items-center gap-3"><button onClick={() => setHistoryOpen(true)} className="rounded-xl border border-neutral-200 p-2 text-slate-700 hover:bg-neutral-50 md:hidden" aria-label="Open chat history">☰</button><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-fiesta-red">Buglasan AI</p><h1 className="text-lg font-bold sm:text-xl">Your festival companion</h1></div></div><span className="hidden rounded-full bg-fiesta-red-light/30 px-3 py-1.5 text-xs font-semibold text-fiesta-red-dark sm:block">{festivalYear} festival guide</span></div></div>
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"><div className="mx-auto max-w-3xl"><ChatInterface messages={messages} isLoading={isLoading} festivalYear={festivalYear} messagesEndRef={messagesEndRef} /></div></div>
        <div className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6"><div className="flex flex-wrap gap-2">{demoQuickQuestions.map((question, index) => <button key={index} onClick={() => handleSendMessage(question)} disabled={isLoading} className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 shadow-sm transition hover:border-fiesta-red hover:text-fiesta-red disabled:opacity-50">{question}</button>)}</div></div>
        <div className="border-t border-neutral-200 bg-white px-4 py-3 sm:px-6"><div className="mx-auto max-w-3xl"><MessageInput onSend={handleSendMessage} disabled={isLoading} placeholder={`Ask about Buglasan Festival ${festivalYear}...`} /></div></div>
      </main>
    </div>
    <AIDisclaimer />
  </div>
}

function getPreferredChatLanguage(): 'en' | 'ceb' | 'fil' {
  const browserLanguage = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase()
  if (browserLanguage.startsWith('fil') || browserLanguage.startsWith('tl')) return 'fil'
  return 'en'
}

function MessageInput({ onSend, disabled, placeholder }: { onSend: (content: string) => void; disabled: boolean; placeholder: string }) {
  const [value, setValue] = useState('')
  const handleSubmit = (event: React.FormEvent) => { event.preventDefault(); if (value.trim() && !disabled) { onSend(value); setValue('') } }
  return <form onSubmit={handleSubmit} className="flex gap-2"><textarea value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSubmit(event) } }} disabled={disabled} placeholder={placeholder} rows={1} className="min-h-[46px] flex-1 resize-none rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm outline-none focus:border-fiesta-red focus:ring-2 focus:ring-fiesta-red/20 disabled:opacity-50" /><button type="submit" disabled={disabled || !value.trim()} className="rounded-2xl bg-fiesta-red px-4 text-white shadow-sm transition hover:bg-fiesta-red-dark disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send message">➤</button></form>
}

export default App
