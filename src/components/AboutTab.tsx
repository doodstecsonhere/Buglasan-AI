import { ABOUT, FESTIVAL_YEAR } from '../data/schedule2026'

export function AboutTab() {
  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h2 className="text-xl font-bold text-navy-900">About the Buglasan Festival</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            The Buglasan Festival is the annual provincial festival of {ABOUT.region}, held every {ABOUT.typical_month} in {ABOUT.host_city}. It celebrates the culture, traditions, and abundance of Negros Oriental through a week-long series of competitions, parades, exhibits, and performances.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-navy-800">Quick Facts</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Festival Year</dt>
              <dd className="font-medium text-slate-900">{FESTIVAL_YEAR}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Region</dt>
              <dd className="font-medium text-slate-900">{ABOUT.region}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Host City</dt>
              <dd className="font-medium text-slate-900">{ABOUT.host_city}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Typical Month</dt>
              <dd className="font-medium text-slate-900">{ABOUT.typical_month}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-bold text-navy-800">What does "Buglasan" mean?</h3>
          <p className="text-sm leading-6 text-slate-700">{ABOUT.meaning_note}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-bold text-navy-800">Official Source</h3>
          <p className="text-sm leading-6 text-slate-700">
            Schedule data is transcribed from the official Buglasan Festival Facebook page. For the latest updates, visit:
          </p>
          <a
            href={ABOUT.official_source}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm font-medium text-navy-600 hover:text-navy-800 hover:underline"
          >
            {ABOUT.official_source}
          </a>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-bold text-amber-800">Disclaimer</h3>
          <p className="text-sm leading-6 text-amber-700">
            This is an unofficial, operator-curated app. It is not affiliated with or endorsed by the Provincial Government of Negros Oriental. AI responses may occasionally be inaccurate. Always verify critical information with official sources.
          </p>
        </div>
      </div>
    </div>
  )
}
