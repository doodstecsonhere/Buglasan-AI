import { useState } from 'react'
import { BottomNav, type TabId } from './components/BottomNav'
import { ScheduleTab } from './components/ScheduleTab'
import { ChatTab } from './components/ChatTab'
import { AboutTab } from './components/AboutTab'

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('schedule')

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-navy-900 px-4 py-3 text-white sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-lg font-black tracking-tight">BUGLASAN AI</span>
          <span className="rounded-full bg-navy-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy-100">2026</span>
        </div>
        <span className="text-xs text-navy-200">Negros Oriental</span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'schedule' && <ScheduleTab />}
        {activeTab === 'chat' && <ChatTab language="en" />}
        {activeTab === 'about' && <AboutTab />}
      </main>

      <BottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  )
}

export default App
