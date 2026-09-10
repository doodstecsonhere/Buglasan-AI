import type { Message } from '../types'

export const CHAT_THREADS_STORAGE_KEY = 'buglasan-ai.chat-threads.v1'

export interface ChatThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: Message[]
}

type StoredThread = Omit<ChatThread, 'messages'> & { messages: Array<Omit<Message, 'timestamp'> & { timestamp: string }> }

function hydrateThread(thread: StoredThread): ChatThread {
  return {
    ...thread,
    messages: thread.messages
      .map(message => ({ ...message, timestamp: new Date(message.timestamp) }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
  }
}

export function loadChatThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(CHAT_THREADS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredThread[]
    return parsed
      .map(hydrateThread)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  } catch {
    return []
  }
}

export function saveChatThreads(threads: ChatThread[]) {
  const serializable: StoredThread[] = threads.map(thread => ({
    ...thread,
    messages: thread.messages.map(message => ({ ...message, timestamp: message.timestamp.toISOString() })),
  }))
  localStorage.setItem(CHAT_THREADS_STORAGE_KEY, JSON.stringify(serializable))
}

export function titleFromMessages(messages: Message[]) {
  const firstUserMessage = messages.find(message => message.role === 'user')
  if (!firstUserMessage) return 'New conversation'
  const title = firstUserMessage.content.replace(/\s+/g, ' ').trim()
  return title.length > 48 ? `${title.slice(0, 48).trimEnd()}…` : title
}

export function createChatThread(messages: Message[]): ChatThread {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), title: titleFromMessages(messages), createdAt: now, updatedAt: now, messages }
}

export function updateChatThreadMessages(threads: ChatThread[], threadId: string, messages: Message[]): ChatThread[] {
  return threads.map(thread => thread.id === threadId
    ? { ...thread, messages, title: titleFromMessages(messages), updatedAt: new Date().toISOString() }
    : thread)
}
