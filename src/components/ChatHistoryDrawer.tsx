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
  return (
    <>
      {open && <button className="fixed inset-0 z-40 bg-slate-950/35 md:hidden" onClick={onClose} aria-label="Close chat history" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[min(88vw,340px)] flex-col bg-white shadow-2xl transition-transform duration-200 md:relative md:z-auto md:shadow-none ${open ? 'translate-x-0' : '-translate-x-full md:hidden'}`} aria-label="Chat history">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-fiesta-red">Your chats</p><h2 className="mt-1 text-lg font-bold text-slate-900">Conversation history</h2></div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-neutral-100 md:hidden" aria-label="Close chat history">×</button>
        </div>
        <button onClick={onNew} className="mx-4 my-4 flex items-center justify-center gap-2 rounded-xl bg-fiesta-red px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-fiesta-red-dark">＋ New Chat</button>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {threads.length === 0 && <p className="px-3 py-8 text-center text-sm text-neutral-500">Your saved conversations will appear here.</p>}
          {threads.map(thread => (
            <div key={thread.id} className={`group mb-1 flex items-start gap-2 rounded-xl p-3 ${thread.id === activeThreadId ? 'bg-fiesta-red-light/30' : 'hover:bg-neutral-50'}`}>
              <button onClick={() => onSelect(thread.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-semibold text-slate-800">{thread.title}</p>
                <p className="mt-1 text-xs text-neutral-500">{new Date(thread.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {thread.messages.length} messages</p>
              </button>
              <button onClick={() => onDelete(thread.id)} className="rounded-lg p-1.5 text-neutral-400 opacity-60 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100" aria-label={`Delete ${thread.title}`}>⌫</button>
            </div>
          ))}
        </div>
      </aside>
    </>
  )
}
