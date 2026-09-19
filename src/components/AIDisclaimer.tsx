import { productConfig } from '../config/productConfig'

export function AIDisclaimer() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 px-3 py-3 sm:px-4">
      <div className="mx-auto max-w-2xl">
        <p className="text-center text-[11px] leading-relaxed text-neutral-600 sm:text-xs">
          ⚠️ <strong>{productConfig.trust.aiDisclaimer}</strong> For official confirmation, check the{' '}
          <a
            href={productConfig.officialSource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-fiesta-red underline underline-offset-2 hover:text-fiesta-red-dark"
          >
            {productConfig.officialSource.pageLabel}
          </a>
          {' '}.
        </p>
        <p className="mt-1 text-center text-[10px] font-mono text-neutral-400 sm:text-[10.5px]">
          {productConfig.trust.nonAffiliationNotice}
        </p>
      </div>
    </footer>
  )
}
