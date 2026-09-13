import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addressedThreadId, CHAT_THREADS_STORAGE_KEY, createChatThread, loadChatThreads, saveChatThreads, titleFromMessages, updateChatThreadMessages } from './chatThreads'

describe('chat thread persistence helpers', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('creates a local title from the first user message', () => {
    expect(titleFromMessages([{ id: '1', role: 'assistant', content: 'Welcome', timestamp: new Date() }, { id: '2', role: 'user', content: '  Where is the parade?  ', timestamp: new Date() }])).toBe('Where is the parade?')
  })

  it('creates a versioned-thread-ready record with timestamps', () => {
    const thread = createChatThread([])
    expect(thread.id).toEqual(expect.any(String))
    expect(new Date(thread.createdAt).toString()).not.toBe('Invalid Date')
    expect(thread.title).toBe('New conversation')
  })

  it('creates a compact, readable title for a long local-history question', () => {
    const question = 'Can you share the complete and official Buglasan Festival schedule for every activity this October?'
    const title = titleFromMessages([{ id: '1', role: 'user', content: question, timestamp: new Date() }])

    expect(title).toBe('Can you share the complete and official Buglasan…')
    expect(title.length).toBeLessThanOrEqual(49)
  })

  it('updates the originating thread without changing another active thread', () => {
    const origin = createChatThread([{ id: 'origin-user', role: 'user', content: 'Origin', timestamp: new Date() }])
    const active = createChatThread([{ id: 'active-user', role: 'user', content: 'Active', timestamp: new Date() }])
    const response = { id: 'origin-answer', role: 'assistant' as const, content: 'Answer', timestamp: new Date() }
    const updated = updateChatThreadMessages([active, origin], origin.id, [...origin.messages, response])

    expect(updated.find(thread => thread.id === origin.id)?.messages).toEqual([...origin.messages, response])
    expect(updated.find(thread => thread.id === active.id)?.messages).toEqual(active.messages)
  })

  it('hydrates canonical structured source URLs and preserves them through serialization', () => {
    const source = { id: 'source-1', postId: 'post-1', title: 'Official page', platform: 'official' as const, postUrl: 'https://negor.gov.ph/buglasan', publishedAt: new Date('2026-01-01T00:00:00.000Z'), festivalYear: 2026, status: 'active' as const }
    const thread = createChatThread([{ id: 'message-1', role: 'assistant', content: 'Answer', timestamp: new Date('2026-01-02T00:00:00.000Z'), sources: [source] }])
    saveChatThreads([thread])

    expect(loadChatThreads()[0].messages[0].sources).toEqual([source])
  })

  it('removes only stale demo messages while retaining legitimate legacy conversations', () => {
    const base = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }
    localStorage.setItem(CHAT_THREADS_STORAGE_KEY, JSON.stringify([
      { ...base, id: 'demo-thread', title: 'Demo', messages: [{ id: 'd1', role: 'assistant', content: 'Derived from demo sources', timestamp: base.createdAt }] },
      { ...base, id: 'mixed-thread', title: 'Mixed', messages: [{ id: 'm1', role: 'user', content: 'What are the official dates?', timestamp: base.createdAt }, { id: 'm2', role: 'assistant', content: 'No demo information matches that query for 2026.', timestamp: base.updatedAt }] },
      { ...base, id: 'real-thread', title: 'Real', messages: [{ id: 'r1', role: 'assistant', content: 'A real saved answer', timestamp: base.createdAt }] },
    ]))

    const threads = loadChatThreads()
    expect(threads.map(thread => thread.id)).toEqual(['mixed-thread', 'real-thread'])
    expect(threads.find(thread => thread.id === 'mixed-thread')?.messages.map(message => message.id)).toEqual(['m1'])
    expect(JSON.parse(localStorage.getItem(CHAT_THREADS_STORAGE_KEY) ?? '[]')).toHaveLength(2)
  })

  it('recognizes only explicit addressed-thread restoration parameters', () => {
    expect(addressedThreadId('')).toBeNull()
    expect(addressedThreadId('?thread=thread-123')).toBe('thread-123')
  })
})
