import type { SourceCitation } from '../types'
import { formatPHDate } from '../utils/dateUtils'

interface SourcesCardProps {
  sources: SourceCitation[]
  festivalYear: number
}

export function SourcesCard({ sources, festivalYear }: SourcesCardProps) {
  if (!sources || sources.length === 0) return null

  return (
    <div className="mt-2 animate-slide-up">
      <details className="group">
        <summary className="flex items-center gap-2 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg cursor-pointer text-sm font-medium text-neutral-700 hover:bg-neutral-100 transition-colors select-none">
          <svg className="w-4 h-4 text-fiesta-red flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Sources ({sources.length})</span>
          <svg className="w-4 h-4 text-neutral-400 ml-auto transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        
        <div className="mt-2 space-y-2 p-2 bg-neutral-50 border border-neutral-200 rounded-lg border-t-none">
          {sources.map((source, index) => (
            <div key={source.id} className="space-y-1.5 last:pb-0">
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 text-xs text-neutral-400 font-mono">{index + 1}.</span>
                <div className="flex-1 min-w-0">
                  <a
                    href={source.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-fiesta-red hover:text-fiesta-red-dark underline-offset-2 hover:underline text-sm"
                  >
                    {source.title}
                  </a>
                  
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-neutral-500">
                    <span className="flex items-center gap-1">
                      <span className="px-1.5 py-0.5 bg-white border border-neutral-200 rounded text-[10px] font-medium capitalize">
                        {source.platform}
                      </span>
                    </span>
                    <span>{source.publishedAt ? formatPHDate(source.publishedAt, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Publication date unknown'}</span>
                    {source.festivalYear !== festivalYear && (
                      <span className="px-1.5 py-0.5 bg-fiesta-yellow-light text-fiesta-yellow-dark rounded text-[10px] font-medium">
                        FY {source.festivalYear}
                      </span>
                    )}
                    {(['active','updated','postponed'].includes(source.status)) && (
                      <span className="px-1.5 py-0.5 bg-fiesta-green-light text-fiesta-green-dark rounded text-[10px] font-medium">
                        Current
                      </span>
                    )}
                    {source.supersedesSourceId && (
                      <span className="px-1.5 py-0.5 bg-fiesta-orange-light text-fiesta-orange-dark rounded text-[10px] font-medium">
                        Updated
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <a
                href={source.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-fiesta-blue hover:text-fiesta-blue-dark underline-offset-2 hover:underline"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View official post
              </a>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
