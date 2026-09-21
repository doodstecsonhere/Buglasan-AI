import { useState } from 'react'
import { SCHEDULE_2026, FESTIVAL_YEAR, FESTIVAL_TIMEZONE, type FestivalEvent } from '../data/schedule2026'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface DayGroup {
  date: string
  dayName: string
  events: FestivalEvent[]
}

function groupByDay(events: FestivalEvent[]): DayGroup[] {
  const map = new Map<string, DayGroup>()
  for (const e of events) {
    if (!map.has(e.date)) {
      const d = new Date(e.date + 'T00:00:00')
      map.set(e.date, { date: e.date, dayName: DAY_NAMES[d.getDay()], events: [] })
    }
    map.get(e.date)!.events.push(e)
  }
  return [...map.values()]
}

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

export function ScheduleTab() {
  const [search, setSearch] = useState('')
  const allDays = groupByDay(SCHEDULE_2026)

  const filtered = search.trim()
    ? SCHEDULE_2026.filter(e => {
        const q = search.toLowerCase()
        return e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q) || (e.note ?? '').toLowerCase().includes(q)
      })
    : SCHEDULE_2026

  const days = search.trim() ? (filtered.length > 0 ? groupByDay(filtered) : []) : allDays

  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-navy-900">Buglasan Festival {FESTIVAL_YEAR} Schedule</h2>
          <p className="text-sm text-slate-600">{SCHEDULE_2026.length} events over 11 days. All times {FESTIVAL_TIMEZONE}.</p>
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search events or venues..."
          className="mb-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
        />
        {days.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No events found for "{search}"</p>
        ) : (
          <div className="space-y-6">
            {days.map(day => (
              <div key={day.date}>
                <div className="sticky top-0 z-10 mb-2 rounded-lg bg-navy-50 px-3 py-2">
                  <h3 className="text-sm font-bold text-navy-800">
                    {day.dayName}, {formatDate(day.date)}
                  </h3>
                  <span className="text-xs text-slate-500">{day.events.length} event{day.events.length > 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-2">
                  {day.events.map(e => (
                    <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-navy-700">{formatTime(e.time)}</p>
                          {e.timeInferred && <p className="text-[10px] text-slate-400">est.</p>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900">{e.title}</p>
                          <p className="text-xs text-slate-600">{e.venue}</p>
                          {e.note && <p className="mt-1 text-xs text-slate-500">{e.note}</p>}
                          {e.legalHoliday && <span className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Legal Holiday</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
