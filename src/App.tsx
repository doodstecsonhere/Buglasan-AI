import { useState, useEffect, useRef, useCallback } from 'react'
import { ChatInterface } from './components/ChatInterface'
import { FacebookBadge } from './components/FacebookBadge'
import { AIDisclaimer } from './components/AIDisclaimer'
import type { Message, FestivalYear } from './types'
import { getCurrentFestivalYear } from './utils/dateUtils'
import { demoMessages, demoQuickQuestions } from './data/demoData'
import { chatService } from './services'

function App() {
  const [messages, setMessages] = useState<Message[]>(demoMessages)
  const [isLoading, setIsLoading] = useState(false)
  const [festivalYear, setFestivalYear] = useState<FestivalYear>(getCurrentFestivalYear())
  const [showYearSelector, setShowYearSelector] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const handleSendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setIsLoading(true)

    try {
      const response = await chatService.sendMessage({
        message: content,
        festivalYear,
        language: 'en',
        conversationHistory: messages.slice(-6).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp.toISOString(),
          sources: m.sources,
        })),
      })

      const aiMessage: Message = {
        id: response.message.id,
        role: 'assistant',
        content: response.message.content,
        timestamp: new Date(response.message.timestamp),
        sources: response.message.sources,
        festivalYear: response.message.festivalYear,
      }

      setMessages(prev => [...prev, aiMessage])
    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again or check the official Buglasan Festival Facebook Page for the latest information.',
        timestamp: new Date(),
        festivalYear,
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, messages, festivalYear])

  const handleQuickQuestion = useCallback((question: string) => {
    handleSendMessage(question)
  }, [handleSendMessage])

  const handleYearChange = useCallback((year: FestivalYear) => {
    setFestivalYear(year)
    setShowYearSelector(false)
    // Clear messages and show welcome for new year
    setMessages(demoMessages)
  }, [])

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Facebook Badge Header */}
      <FacebookBadge />

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Year Selector Bar */}
        <div className="bg-white border-b border-neutral-200 px-4 py-2">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={() => setShowYearSelector(!showYearSelector)}
              className="flex items-center gap-2 text-sm font-medium text-fiesta-red hover:text-fiesta-red-dark transition-colors"
              aria-expanded={showYearSelector}
              aria-controls="year-selector-menu"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>Festival Year: {festivalYear}</span>
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showYearSelector && (
              <div id="year-selector-menu" className="mt-2 animate-slide-up">
                <div className="bg-white border border-neutral-200 rounded-lg shadow-lg overflow-hidden">
                  {chatService.getAvailableYears().map(year => (
                    <button
                      key={year}
                      onClick={() => handleYearChange(year)}
                      className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                        festivalYear === year
                          ? 'bg-fiesta-red text-white'
                          : 'text-neutral-700 hover:bg-fiesta-red-light'
                      }`}
                    >
                      {year} {year === getCurrentFestivalYear() && '(Current)'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto w-full">
          <ChatInterface
            messages={messages}
            isLoading={isLoading}
            festivalYear={festivalYear}
            messagesEndRef={messagesEndRef}
          />
        </div>

        {/* Quick Question Chips */}
        <div className="px-4 pb-4 max-w-2xl mx-auto w-full">
          <div className="flex flex-wrap gap-2">
            {demoQuickQuestions.map((question, index) => (
              <button
                key={index}
                onClick={() => handleQuickQuestion(question)}
                disabled={isLoading}
                className="px-3 py-1.5 text-sm bg-white border border-neutral-200 rounded-full text-neutral-700 hover:bg-fiesta-red-light hover:border-fiesta-red hover:text-fiesta-red transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {question}
              </button>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div className="bg-white border-t border-neutral-200 px-4 py-3 max-w-2xl mx-auto w-full">
          <MessageInput
            onSend={handleSendMessage}
            disabled={isLoading}
            placeholder={`Ask about Buglasan Festival ${festivalYear}...`}
          />
        </div>
      </main>

      {/* AI Disclaimer Footer */}
      <AIDisclaimer />
    </div>
  )
}

function MessageInput({ onSend, disabled, placeholder }: { 
  onSend: (content: string) => void
  disabled: boolean
  placeholder: string
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim() && !disabled) {
      onSend(value)
      setValue('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className="flex-1 px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-fiesta-red focus:border-transparent resize-none min-h-[44px] disabled:opacity-50"
        style={{ maxHeight: '120px' }}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="p-2.5 bg-fiesta-red text-white rounded-full hover:bg-fiesta-red-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        aria-label="Send message"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </form>
  )
}

export default App