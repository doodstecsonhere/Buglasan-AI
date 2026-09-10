import { useEffect, useRef } from 'react'
import type { ChatThread } from '../utils/chatThreads'

interface Props {
  threads: ChatThread[]
  activeThreadId: string
  open: boolean
  onClose: () => void
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

export function ChatHistoryDrawer({ threads, activeThreadId, open, onClose, onNew, onSelect, onDelete }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); if (!open) previouslyFocused.current?.focus() }
  }, [open, onClose])

  return (
    <>
      {open && <button className="drawer-backdrop" onClick={onClose} aria-label="Close chat history" />}
      <aside className={`history-sidebar ${open ? 'is-open' : ''}`} aria-label="Chat history">
        <div className="history-heading">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-fiesta-red">Your chats</p><h2 className="mt-1 text-lg font-bold text-slate-900">Conversation history</h2></div>
          <button ref={closeButtonRef} onClick={onClose} className="icon-button md:hidden" aria-label="Close chat history">×</button>
        </div>
        <button onClick={onNew} className="new-chat-button">＋ New Chat</button>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {threads.length === 0 && <p className="px-3 py-8 text-center text-sm text-neutral-500">Your saved conversations will appear here.</p>}
          {threads.map(thread => (
            <div key={thread.id} className={`thread-row group ${thread.id === activeThreadId ? 'active' : ''}`}>
              <button onClick={() => onSelect(thread.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-semibold text-slate-800">{thread.title}</p>
                <p className="mt-1 text-xs text-neutral-500">{new Date(thread.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {thread.messages.length} messages</p>
              </button>
              <button onClick={() => onDelete(thread.id)} className="delete-thread" aria-label={`Delete ${thread.title}`}>×</button>
            </div>
          ))}
        </div>
      </aside>
    </>
  )
}
