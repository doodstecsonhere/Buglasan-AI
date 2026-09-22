import { describe, expect, it } from 'vitest'
import { ChatInterface, FreshnessIndicator } from './ChatInterface'
import type { Message } from '../types'
import type { FreshnessMetadata, FreshnessTimestampKind } from '../utils/freshness'

const collectText = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(collectText).join('')
  if (value && typeof value === 'object' && 'props' in value) return collectText((value as { props?: { children?: unknown } }).props?.children)
  return ''
}

const evaluated = (kind: FreshnessTimestampKind, timestamp: string | null, formattedAt: string | null) => Object.freeze({ kind, state: timestamp ? 'FRESH' as const : 'UNKNOWN' as const, timestamp, ageHours: timestamp ? 10 : null, formattedAt })

const metadataWith = (knowledgeBaseUpdatedAt: { timestamp: string | null; formattedAt: string | null }): FreshnessMetadata => ({
  evaluation: {
    overallState: knowledgeBaseUpdatedAt.timestamp ? 'FRESH' : 'UNKNOWN',
    timestamps: {
      sourcePublishedAt: evaluated('sourcePublishedAt', null, null),
      sourceCollectedAt: evaluated('sourceCollectedAt', null, null),
      knowledgeBaseUpdatedAt: evaluated('knowledgeBaseUpdatedAt', knowledgeBaseUpdatedAt.timestamp, knowledgeBaseUpdatedAt.formattedAt),
    },
  },
  corpusHealth: { state: 'HEALTHY', humilityFlag: false, copy: '' },
  warning: 'NONE',
})

const quietLine = (metadata?: FreshnessMetadata, isOnline = true): string => collectText(FreshnessIndicator({ metadata, isOnline }))

describe('ChatInterface knowledge-update line', () => {
  it('shows the quiet update line when a valid knowledge-base timestamp exists', () => {
    const text = quietLine(metadataWith({ timestamp: '2026-09-14T08:00:00.000Z', formattedAt: 'September 14, 2026' }))
    expect(text).toContain('Knowledge updated September 14, 2026.')
    expect(text).not.toContain('not available')
  })

  it('renders nothing when the knowledge-update time is missing', () => {
    expect(quietLine()).toBe('')
  })

  it('renders nothing when the knowledge-update timestamp is invalid', () => {
    expect(quietLine(metadataWith({ timestamp: null, formattedAt: null }))).toBe('')
  })

  it('stays silent while an answer is loading with no timestamp available', () => {
    // Loading answers reach the same path: the conversation carries an assistant
    // message without freshness metadata, exactly like mid-request ChatInterface.
    const answer: Message = { id: 'a1', role: 'assistant', content: 'The parade starts at 4 PM.', timestamp: new Date('2026-09-20T08:00:00Z') }
    const tree = ChatInterface({ messages: [answer], isLoading: true, isOnline: true, messagesEndRef: { current: null } })
    // No visible placeholder node may exist anywhere in the loading tree.
    expect(JSON.stringify(tree)).not.toMatch(/not available|update time|unknown/i)
    expect(quietLine()).toBe('')
  })

  it('keeps the offline hint attached to a real update line only', () => {
    expect(quietLine(undefined, false)).toBe('')
    const dated = quietLine(metadataWith({ timestamp: '2026-09-14T08:00:00.000Z', formattedAt: 'September 14, 2026' }), false)
    expect(dated).toContain('Knowledge updated September 14, 2026.')
    expect(dated).toContain('Newer information may exist online.')
  })
})
