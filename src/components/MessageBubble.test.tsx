import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderCitedContent, renderMarkdownText } from './MessageBubble'
import type { SourceCitation } from '../types'

describe('MessageBubble response rendering', () => {
  const element = (value: unknown) => {
    expect(isValidElement(value)).toBe(true)
    return value as ReactElement<{ children?: ReactElement<{ children?: string }> | string; href?: string }>
  }

  it('renders generated Markdown emphasis without displaying its delimiters', () => {
    const rendered = renderMarkdownText('**Festival schedule**\n*Demo fixtures only.*')

    const elements = rendered.filter(isValidElement)
    expect(elements).toHaveLength(2)
    expect(element(elements[0]).type).toBe('strong')
    expect(element(elements[0]).props.children).toBe('Festival schedule')
    expect(element(elements[1]).type).toBe('em')
    expect(element(elements[1]).props.children).toBe('Demo fixtures only.')
  })

  it('converts valid citation markers to mapped links while formatting adjacent Markdown', () => {
    const sources: SourceCitation[] = [{
      id: 'schedule-2026',
      title: 'Official schedule',
      platform: 'facebook',
      postUrl: 'https://example.com/schedule',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      festivalYear: 2026,
      status: 'active',
    }]

    const rendered = renderCitedContent('**Schedule** _(src: schedule-2026)_', sources)
    const content = rendered[0]

    const contentElement = element(content)
    const contentChildren = contentElement.props.children as unknown as unknown[]
    expect(element(contentChildren[1]).type).toBe('strong')
    const citationLink = element(rendered[1])
    expect(citationLink.type).toBe('a')
    expect(citationLink.props.href).toBe(sources[0].postUrl)
    expect(citationLink.props.children).toEqual(['[', 1, ']'])
  })
})
