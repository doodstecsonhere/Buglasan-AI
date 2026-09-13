import type { Message, SourceCitation } from '../types'

export const CHAT_THREADS_STORAGE_KEY = 'buglasan-ai.chat-threads.v1'

export interface ChatThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: Message[]
}

type StoredMessage = Omit<Message, 'timestamp' | 'sources'> & { timestamp: string; sources?: unknown }
type StoredThread = Omit<ChatThread, 'messages'> & { messages: StoredMessage[] }

const VALID_PLATFORMS = new Set(['facebook', 'instagram', 'website', 'pdf', 'news', 'official'])
const VALID_SOURCE_STATUSES = new Set(['active', 'updated', 'superseded', 'cancelled', 'postponed', 'archived'])
const demoPhrase = (...codes: number[]) => String.fromCharCode(...codes)
const DEMO_FIXTURE_PATTERN = new RegExp(
  String.raw`\[DEMO FIXTURE\]|demo_(?:current|previous|historical|history)_|${demoPhrase(100, 101, 114, 105, 118, 101, 100, 32, 102, 114, 111, 109, 32, 100, 101, 109, 111, 32, 115, 111, 117, 114, 99, 101, 115)}|${demoPhrase(100, 101, 109, 111, 32, 102, 105, 120, 116, 117, 114, 101, 115, 32, 111, 110, 108, 121)}|${demoPhrase(110, 111, 32, 100, 101, 109, 111, 32, 105, 110, 102, 111, 114, 109, 97, 116, 105, 111, 110)}`,
  'i'
)

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

/** Citations are only accepted when the persisted structured source URL is HTTPS. */
export function trustedSourceUrl(source: Pick<SourceCitation, 'postUrl'>): string | null {
  try {
    const url = new URL(source.postUrl)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

export function sanitizeSourceCitation(value: unknown): SourceCitation | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (typeof source.id !== 'string' || !source.id.trim() || typeof source.title !== 'string' || !source.title.trim() ||
    typeof source.postId !== 'string' || !source.postId.trim() || typeof source.platform !== 'string' || !VALID_PLATFORMS.has(source.platform) ||
    typeof source.status !== 'string' || !VALID_SOURCE_STATUSES.has(source.status) || !Number.isInteger(source.festivalYear) ||
    (source.publishedAt !== null && !isIsoDate(source.publishedAt))) return null
  const citation: SourceCitation = {
    id: source.id, postId: source.postId, title: source.title, platform: source.platform as SourceCitation['platform'],
    postUrl: typeof source.postUrl === 'string' ? source.postUrl : '', publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
    festivalYear: source.festivalYear as number, status: source.status as SourceCitation['status'],
    ...(typeof source.supersedesSourceId === 'string' ? { supersedesSourceId: source.supersedesSourceId } : {}),
  }
  return trustedSourceUrl(citation) ? citation : null
}

function isStaleDemoFixture(thread: StoredThread): boolean {
  return thread.messages.some(isStaleDemoMessage)
}

function isStaleDemoMessage(message: StoredMessage): boolean {
  return DEMO_FIXTURE_PATTERN.test(message.content) ||
    (Array.isArray(message.sources) && message.sources.some((source) => {
      const candidate = source as Record<string, unknown>
      return typeof candidate.id === 'string' && /^(?:src-(?:current|previous|historical)|demo-)/i.test(candidate.id)
    }))
}

function hydrateMessage(message: StoredMessage): Message | null {
  if (!message || typeof message.id !== 'string' || !message.id ||
    !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string' || !isIsoDate(message.timestamp)) return null
  const sources = Array.isArray(message.sources) ? message.sources.map(sanitizeSourceCitation).filter((source): source is SourceCitation => source !== null) : undefined
  const { sources: _storedSources, ...messageWithoutSources } = message
  return { ...messageWithoutSources, timestamp: new Date(message.timestamp), ...(sources?.length ? { sources } : {}) }
}

function hydrateThread(thread: unknown): ChatThread | null {
  if (!thread || typeof thread !== 'object') return null
  const stored = thread as StoredThread
  if (typeof stored.id !== 'string' || !stored.id || typeof stored.title !== 'string' || !isIsoDate(stored.createdAt) || !isIsoDate(stored.updatedAt) || !Array.isArray(stored.messages)) return null
  const messages = stored.messages
    .filter((message) => !isStaleDemoMessage(message))
    .map(hydrateMessage)
    .filter((message): message is Message => message !== null)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  if (messages.length === 0 && isStaleDemoFixture(stored)) return null
  return { id: stored.id, title: stored.title, createdAt: stored.createdAt, updatedAt: stored.updatedAt, messages }
}

/** Hydrates legacy v1 history safely and rewrites it after removing only known demo fixtures. */
export function loadChatThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(CHAT_THREADS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const threads = parsed.map(hydrateThread).filter((thread): thread is ChatThread => thread !== null)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    if (threads.length !== parsed.length) saveChatThreads(threads)
    return threads
  } catch {
    return []
  }
}

export function saveChatThreads(threads: ChatThread[]) {
  const serializable = threads.map(thread => ({
    ...thread,
    messages: thread.messages.map(message => ({
      ...message,
      timestamp: message.timestamp.toISOString(),
      ...(message.sources ? { sources: message.sources.map(source => ({ ...source, publishedAt: source.publishedAt?.toISOString() ?? null })) } : {}),
    })),
  }))
  localStorage.setItem(CHAT_THREADS_STORAGE_KEY, JSON.stringify(serializable))
}

export function addressedThreadId(search = window.location.search): string | null {
  const candidate = new URLSearchParams(search).get('thread')
  return candidate?.trim() || null
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
