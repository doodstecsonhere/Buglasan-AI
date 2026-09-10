import { describe, expect, it } from 'vitest'
import { createChatThread, titleFromMessages, updateChatThreadMessages } from './chatThreads'

describe('chat thread persistence helpers', () => {
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
})
