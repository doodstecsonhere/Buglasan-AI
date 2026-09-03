export function AIDisclaimer() {
  return (
    <footer className="bg-neutral-50 border-t border-neutral-200 px-4 py-3">
      <div className="max-w-2xl mx-auto">
        <p className="text-center text-xs text-neutral-500 leading-relaxed">
          ⚠️ <strong>Buglasan AI may occasionally get details wrong.</strong> For official confirmation, check the{' '}
          <a
            href="https://www.facebook.com/Buglasan"
            target="_blank"
            rel="noopener noreferrer"
            className="text-fiesta-red hover:text-fiesta-red-dark underline font-medium"
          >
            Buglasan Festival Facebook Page
          </a>
          {' '}.
        </p>
        <p className="text-center text-[10px] text-neutral-400 mt-1 font-mono">
          Data sourced from official channels. Not affiliated with the Provincial Government of Negros Oriental.
        </p>
      </div>
    </footer>
  )
}