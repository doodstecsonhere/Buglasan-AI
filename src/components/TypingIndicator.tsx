export function TypingIndicator() {
  return (
    <div className="flex items-start gap-2 animate-fade-in">
      <div className="flex-shrink-0 w-8 h-8 bg-fiesta-red rounded-full flex items-center justify-center text-white text-xs font-bold">
        🎭
      </div>
      
      <div className="bg-white border border-neutral-200 rounded-2xl rounded-bl-md px-4 py-2.5 shadow-sm">
        <div className="flex gap-1 items-center h-6">
          <span className="w-2 h-2 bg-fiesta-red rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-fiesta-red rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-fiesta-red rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}