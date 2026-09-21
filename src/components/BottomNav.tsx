export type TabId = 'schedule' | 'chat' | 'about'

interface Tab {
  id: TabId
  label: string
  icon: string
}

const TABS: Tab[] = [
  { id: 'schedule', label: 'Schedule', icon: '📅' },
  { id: 'chat', label: 'Ask AI', icon: '💬' },
  { id: 'about', label: 'About', icon: 'ℹ️' },
]

export function BottomNav({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav
      className="flex shrink-0 border-t border-slate-200 bg-white"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Main navigation"
    >
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex flex-1 flex-col items-center gap-1 py-2.5 transition ${
            active === tab.id ? 'text-navy-700' : 'text-slate-400 hover:text-slate-600'
          }`}
          aria-current={active === tab.id ? 'page' : undefined}
        >
          <span className="text-xl">{tab.icon}</span>
          <span className="text-xs font-semibold">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
