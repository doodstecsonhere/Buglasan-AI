import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react'
import { ChatInterface } from './components/ChatInterface'
import { FacebookBadge } from './components/FacebookBadge'
import { ChatHistoryDrawer } from './components/ChatHistoryDrawer'
import { AIDisclaimer } from './components/AIDisclaimer'
import type { Message } from './types'
import { getCurrentFestivalYear } from './utils/dateUtils'
import { chatService } from './services'
import { createChatThread, loadChatThreads, saveChatThreads, titleFromMessages, updateChatThreadMessages, type ChatThread } from './utils/chatThreads'
import { readInstallDismissed, writeInstallDismissed } from './utils/installPrompt'

type ChatLanguage = 'en' | 'ceb' | 'fil'
interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

function App() {
  const festivalYear = getCurrentFestivalYear()
  const [threads, setThreads] = useState<ChatThread[]>(() => loadChatThreads())
  const [activeThreadId, setActiveThreadId] = useState(() => loadChatThreads()[0]?.id ?? '')
  const [messages, setMessages] = useState<Message[]>(() => loadChatThreads()[0]?.messages ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chatLanguage] = useState<ChatLanguage>(getPreferredChatLanguage)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installDismissed, setInstallDismissed] = useState(readInstallDismissed)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const activeThreadRef = useRef(activeThreadId)

  useEffect(() => { saveChatThreads(threads) }, [threads])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])
  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    return () => { window.removeEventListener('online', updateOnlineStatus); window.removeEventListener('offline', updateOnlineStatus) }
  }, [])
  useEffect(() => {
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as BeforeInstallPromptEvent) }
    const installed = () => { setInstallPrompt(null); setInstallDismissed(true) }
    window.addEventListener('beforeinstallprompt', beforeInstall)
    window.addEventListener('appinstalled', installed)
    return () => { window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', installed) }
  }, [])

  const persistMessages = useCallback((nextMessages: Message[], targetThreadId: string, createIfMissing = true) => {
    const thread = !targetThreadId && createIfMissing ? createChatThread(nextMessages) : null
    const persistedThreadId = targetThreadId || thread?.id || ''
    if (activeThreadRef.current === targetThreadId || !targetThreadId) setMessages(nextMessages)
    setThreads(previous => {
      const current = previous.find(item => item.id === persistedThreadId)
      if (current) return updateChatThreadMessages(previous, persistedThreadId, nextMessages)
      if (!thread || !createIfMissing) return previous
      activeThreadRef.current = persistedThreadId
      setActiveThreadId(persistedThreadId)
      return [{ ...thread, messages: nextMessages, title: titleFromMessages(nextMessages), updatedAt: new Date().toISOString() }, ...previous]
    })
    return persistedThreadId
  }, [])

  const handleSendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return
    if (!isOnline) { setErrorMessage('You are offline. Reconnect to send a question; your saved conversation is still available.'); return }
    setErrorMessage(null)
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: content.trim(), timestamp: new Date() }
    const history = [...messages, userMessage]
    const originThreadId = persistMessages(history, activeThreadId)
    setIsLoading(true)
    try {
      const response = await chatService.sendMessage({ message: content, festivalYear, language: chatLanguage, conversationHistory: messages.slice(-6).map(m => ({ ...m, timestamp: m.timestamp.toISOString() })) })
      persistMessages([...history, { id: response.message.id, role: 'assistant', content: response.message.content, timestamp: new Date(response.message.timestamp), sources: response.message.sources, festivalYear: response.message.festivalYear, claimCitations: response.message.claimCitations }], originThreadId, false)
    } catch (error) {
      console.error('Chat error:', error)
      setErrorMessage(error instanceof Error && error.name === 'ChatTimeoutError'
        ? 'The answer took too long. No retry was sent automatically; please try once more.'
        : 'We could not get an answer. Check your connection and try again.')
    } finally { setIsLoading(false) }
  }, [activeThreadId, chatLanguage, festivalYear, isLoading, isOnline, messages, persistMessages])

  const newChat = useCallback(() => { activeThreadRef.current = ''; setActiveThreadId(''); setMessages([]); setErrorMessage(null); setHistoryOpen(false); window.setTimeout(() => composerRef.current?.focus(), 0) }, [])
  const selectThread = useCallback((id: string) => { const thread = threads.find(item => item.id === id); if (thread) { activeThreadRef.current = id; setActiveThreadId(id); setMessages(thread.messages); setHistoryOpen(false) } }, [threads])
  const deleteThread = useCallback((id: string) => { setThreads(previous => previous.filter(thread => thread.id !== id)); if (id === activeThreadId) newChat() }, [activeThreadId, newChat])
  const installApp = async () => { if (!installPrompt) return; await installPrompt.prompt(); const result = await installPrompt.userChoice; if (result.outcome === 'dismissed') { writeInstallDismissed(); setInstallDismissed(true) }; setInstallPrompt(null) }
  const quickQuestions = ["What are the Buglasan events for today?", "What are the Buglasan events tomorrow?", "What's the latest update?"]
  const isStandalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

  return <div className="app-shell flex min-h-[100dvh] flex-col overflow-hidden text-slate-900">
    <a href="#chat-composer" className="skip-link">Skip to message composer</a>
    <FacebookBadge />
    <div className="mx-auto flex min-h-0 w-full flex-1 max-w-[1440px]">
      <ChatHistoryDrawer threads={threads} activeThreadId={activeThreadId} open={historyOpen} onClose={() => setHistoryOpen(false)} onNew={newChat} onSelect={selectThread} onDelete={deleteThread} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="app-header"><div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><button onClick={() => setHistoryOpen(true)} className="icon-button md:hidden" aria-label="Open chat history">☰</button><img className="brand-mark" src="/icons/icon-192.png" alt="" aria-hidden="true" /><div className="min-w-0"><p className="brand-name">Buglasan AI</p><h1 className="truncate text-base font-bold sm:text-lg">Your Festival Guide</h1></div></div>{installPrompt && !installDismissed && !isStandalone && <button type="button" className="install-button" onClick={installApp}>Install app</button>}</div></header>
        {!isOnline && <p className="bg-fiesta-yellow-light px-4 py-2 text-center text-sm font-medium text-slate-800" role="status">You’re offline. Saved chats remain available.</p>}
        <div className="conversation-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6" aria-live="polite"><div className="mx-auto w-full max-w-4xl"><ChatInterface messages={messages} isLoading={isLoading} messagesEndRef={messagesEndRef} /></div></div>
        {errorMessage && <div className="mx-auto w-full max-w-3xl px-4 pb-2 sm:px-6"><div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><span>{errorMessage}</span><button type="button" onClick={() => setErrorMessage(null)} className="rounded px-2 py-1 font-semibold hover:bg-red-100">Dismiss</button></div></div>}
        {messages.length === 0 && <div className="mx-auto w-full max-w-4xl px-4 pb-3 sm:px-6"><div className="suggestions" aria-label="Common questions">{quickQuestions.map(question => <button key={question} onClick={() => handleSendMessage(question)} disabled={isLoading || !isOnline} className="suggestion disabled:opacity-50">{question}</button>)}</div></div>}
        <div className="composer-dock"><div className="mx-auto w-full max-w-4xl"><MessageInput inputRef={composerRef} onSend={handleSendMessage} disabled={isLoading || !isOnline} placeholder="Ask about Buglasan Festival..." /></div></div>
      </main>
    </div>
    <AIDisclaimer />
  </div>
}

function getPreferredChatLanguage(): ChatLanguage {
  const browserLanguage = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase()
  if (browserLanguage.startsWith('fil') || browserLanguage.startsWith('tl')) return 'fil'
  if (browserLanguage.startsWith('ceb')) return 'ceb'
  return 'en'
}

function MessageInput({ onSend, disabled, placeholder, inputRef }: { onSend: (content: string) => void; disabled: boolean; placeholder: string; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const [value, setValue] = useState('')
  const handleSubmit = (event: FormEvent) => { event.preventDefault(); if (value.trim() && !disabled) { onSend(value); setValue('') } }
  return <form id="chat-composer" onSubmit={handleSubmit} className="composer-form"><label className="sr-only" htmlFor="message">Your question</label><textarea ref={inputRef} id="message" value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSubmit(event) } }} disabled={disabled} placeholder={placeholder} rows={1} maxLength={2000} aria-describedby="message-help" className="composer-input" /><button type="submit" disabled={disabled || !value.trim()} className="send-button" aria-label="Send message">↑</button><p id="message-help" className="sr-only">Press Enter to send. Press Shift and Enter for a new line.</p></form>
}

export default App
