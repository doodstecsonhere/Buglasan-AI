import { productConfig } from '../config/productConfig'

// The disclosure has to stay quiet and short. The footer communicates the trust
// disclosure using ONLY the primary sentence (independence, AI fallibility, and the
// official page pointer); the separate non-affiliation second line was redundant and
// is no longer rendered. Mobile keeps the shorter accepted wording so the footer never
// becomes a wall of text above the home indicator.
const assistantName = productConfig.identity.assistantName
const pageLabel = productConfig.officialSource.pageLabel
// Mobile repeats the festival name less often than it has to: the page label is shortened
// to what it is called once the reader is already looking at this product.
const shortPageLabel = pageLabel.replace(productConfig.identity.festivalName, '').replace(/\s+/g, ' ').trim() || pageLabel

export function AIDisclaimer() {
  return (
    <footer className="app-footer">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-0.5 text-center">
        <p className="text-balance text-xs leading-5 text-neutral-600 sm:text-[13px]">
          <span className="sm:hidden">Independent, unofficial project. </span>
          <span className="hidden sm:inline">{assistantName} is an independent, unofficial project. </span>
          AI can make mistakes. Check the official{' '}
          {/* Kept unbroken so the link text can never wrap “Page.” onto a line of its own. */}
          <span className="whitespace-nowrap">
            <a
              href={productConfig.officialSource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-fiesta-red underline underline-offset-2 hover:text-fiesta-red-dark"
            >
              <span className="sm:hidden">{shortPageLabel}</span>
              <span className="hidden sm:inline">{pageLabel}</span>
            </a>
            .
          </span>
        </p>
      </div>
    </footer>
  )
}
