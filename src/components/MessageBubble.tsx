import type { Message } from '../types'
import { formatRelativeTime } from '../utils/dateUtils'

interface MessageBubbleProps {
  message: Message
  festivalYear: number
  showAvatar: boolean
}

export function MessageBubble({ message, festivalYear, showAvatar }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const timeString = formatRelativeTime(message.timestamp)
  
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && showAvatar && (
        <div className="flex-shrink-0 w-8 h-8 bg-fiesta-red rounded-full flex items-center justify-center text-white text-xs font-bold">
          🎭
        </div>
      )}
      
      <div className={`max-w-[80%] ${isUser ? 'order-2' : 'order-1'}`}>
        <div
          className={`
            px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
            ${isUser
              ? 'bg-fiesta-red text-white rounded-br-md'
              : 'bg-white text-neutral-900 border border-neutral-200 rounded-bl-md shadow-sm'
            }
          `}
        >
          {message.content}
        </div>
        
        <div className={`flex items-center gap-1.5 mt-1 text-xs text-neutral-400 ${isUser ? 'justify-end pr-1' : 'justify-start pl-1'}`}>
          <span>{timeString}</span>
          {message.festivalYear && message.festivalYear !== festivalYear && (
            <span className="px-1.5 py-0.5 bg-fiesta-red-light text-fiesta-red rounded text-[10px] font-medium">
              FY {message.festivalYear}
            </span>
          )}
        </div>
      </div>
      
      {isUser && showAvatar && (
        <div className="flex-shrink-0 w-8 h-8 bg-fiesta-blue rounded-full flex items-center justify-center text-white text-xs font-bold">
          👤
        </div>
      )}
    </div>
  )
}