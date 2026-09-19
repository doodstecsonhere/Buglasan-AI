import { productConfig } from '../config/productConfig'

export function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <img className="message-avatar" src={productConfig.branding.assistantAvatarPath} alt={productConfig.branding.assistantAvatarAlt} />

      <div className="rounded-2xl rounded-bl-md border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
        <span className="sr-only">{productConfig.identity.assistantName} is typing…</span>
        <div aria-hidden="true" className="flex h-6 items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-brand-blue animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="h-2 w-2 rounded-full bg-brand-blue animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="h-2 w-2 rounded-full bg-brand-blue animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}
