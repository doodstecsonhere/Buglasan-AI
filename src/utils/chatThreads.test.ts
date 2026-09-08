import { describe, expect, it } from 'vitest'
import { createChatThread, titleFromMessages } from './chatThreads'

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
})
