import { productConfig } from '../config/productConfig'

// The non-affiliation notice is one configured sentence pair. Present each as its
// own readable line on mobile (never shrunk to unreadable mono text or hidden) while
// keeping the same material facts inline on desktop.
const notice = productConfig.trust.nonAffiliationNotice
const boundary = notice.indexOf('. ')
const sourcingNotice = boundary >= 0 ? notice.slice(0, boundary + 1) : notice
const affiliationNotice = boundary >= 0 ? notice.slice(boundary + 2).trim() : ''

export function AIDisclaimer() {
  return (
    <footer className="shrink-0 border-t border-neutral-200 bg-neutral-50/90 px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-1 text-center">
        <p className="text-xs leading-5 text-neutral-600 sm:text-[13px]">
          <strong className="font-semibold">{productConfig.trust.aiDisclaimer}</strong>{' '}
          For official confirmation, check the{' '}
          <a
            href={productConfig.officialSource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-fiesta-red underline underline-offset-2 hover:text-fiesta-red-dark"
          >
            {productConfig.officialSource.pageLabel}
          </a>
          .
        </p>
        <p className="text-[11px] leading-5 text-neutral-500 sm:text-xs">
          <span>{sourcingNotice}</span>
          {affiliationNotice && (
            <span className="mt-0.5 block sm:mt-0 sm:inline">
              <span className="hidden sm:inline"> </span>
              Independent project · {affiliationNotice}
            </span>
          )}
        </p>
      </div>
    </footer>
  )
}
