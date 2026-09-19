import type { SourceCitation } from '../types'
import { formatPHDate } from '../utils/dateUtils'
import { trustedSourceUrl } from '../utils/chatThreads'

interface SourcesCardProps {
  sources: SourceCitation[]
}

const CURRENT_STATUSES = ['active', 'updated', 'postponed']
const SUPERSEDED_STATUSES = ['superseded', 'cancelled', 'archived']

function publicationDate(source: SourceCitation): string | null {
  const date = source.publishedAt
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  return formatPHDate(date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function SourcesCard({ sources }: SourcesCardProps) {
  const safeSources = Array.isArray(sources) ? sources.filter((source): source is SourceCitation => !!source && typeof source === 'object' && typeof source.id === 'string' && typeof source.title === 'string') : []
  if (safeSources.length === 0) return null

  return (
    <div className="mt-2 animate-slide-up max-w-2xl">
      <details className="group rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 transition-colors select-none hover:text-slate-700">
          <svg className="h-3.5 w-3.5 flex-shrink-0 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Evidence · {safeSources.length} {safeSources.length === 1 ? 'source' : 'sources'}</span>
          <svg className="ml-auto h-4 w-4 text-neutral-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>

        <ul className="mt-1 border-t border-slate-100">
          {safeSources.map((source, index) => {
            const postUrl = trustedSourceUrl(source)
            const date = publicationDate(source)
            const isCurrent = CURRENT_STATUSES.includes(source.status)
            const isSuperseded = SUPERSEDED_STATUSES.includes(source.status)
            // "Current" only reads as useful next to a known publication date; an undated
            // source stays quiet. "Superseded" carries meaning on its own, so it is kept
            // even without a date.
            const showCurrent = isCurrent && !!date
            const showSuperseded = isSuperseded
            return (
              <li key={source.id} className="border-b border-slate-100 py-2 last:border-b-0">
                <div className="flex items-baseline gap-2">
                  <span className="w-4 flex-shrink-0 text-right font-mono text-xs text-slate-400">{index + 1}</span>
                  {postUrl ? (
                    <a
                      href={postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-baseline gap-1 break-words text-sm font-semibold text-brand-blue underline-offset-2 hover:underline"
                      aria-label={`Open source: ${source.title}`}
                    >
                      <span className="min-w-0">{source.title}</span>
                      <svg className="h-3 w-3 flex-shrink-0 self-center" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ) : (
                    <span className="min-w-0 break-words text-sm font-semibold text-slate-700">{source.title}</span>
                  )}
                </div>
                {(date || showSuperseded) && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-6 text-[11px] leading-4 text-slate-500">
                    <span className="capitalize">{source.platform}</span>
                    {date && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{date}</span>
                      </>
                    )}
                    {(showCurrent || showSuperseded) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={showCurrent ? 'rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700' : 'rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500'}>
                          {showCurrent ? 'Current' : 'Superseded'}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </details>
    </div>
  )
}
