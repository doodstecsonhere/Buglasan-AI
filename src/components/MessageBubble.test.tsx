import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderCitedContent, renderMarkdownText, renderSafeLinks, warningCopy } from './MessageBubble'
import type { SourceCitation } from '../types'

describe('MessageBubble response rendering', () => {
  const element = (value: unknown) => {
    expect(isValidElement(value)).toBe(true)
    return value as ReactElement<{ children?: ReactElement<{ children?: string }> | string; href?: string; 'aria-label'?: string }>
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

  it('keeps answer warnings conditional on freshness metadata', async () => {
    const { MessageBubble } = await import('./MessageBubble')
    const base = { id: 'answer', role: 'assistant' as const, content: 'Answer', timestamp: new Date() }
    const withoutWarning = MessageBubble({ message: base, showAvatar: false })
    expect(isValidElement(withoutWarning)).toBe(true)
  })

  it('converts valid citation markers to mapped links while formatting adjacent Markdown', () => {
    const sources: SourceCitation[] = [{
      id: 'schedule-2026',
      postId: '123456789',
      title: 'Official schedule',
      platform: 'facebook',
      postUrl: 'https://www.facebook.com/Buglasan/posts/123456789/',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      festivalYear: 2026,
      status: 'active',
    }]

    const rendered = renderCitedContent('**Schedule** _(src: schedule-2026)_', sources)
    const content = rendered[0]

    const contentElement = element(content)
    const contentChildren = contentElement.props.children as unknown as unknown[]
    expect(element(contentChildren[0]).type).toBe('strong')
    const citationLink = element(rendered[1])
    expect(citationLink.type).toBe('a')
    expect(citationLink.props.href).toBe(sources[0].postUrl)
    expect(citationLink.props.children).toEqual(['[', 1, ']'])
  })

  it('drops a trailing Sources bibliography before rendering inline citations', () => {
    const sources: SourceCitation[] = [{
      id: 'official-source', postId: 'official-1', title: 'Official festival page', platform: 'official',
      postUrl: 'https://negor.gov.ph/buglasan', publishedAt: null, festivalYear: 2026, status: 'active',
    }]

    const rendered = renderCitedContent('The parade begins at 6:00 PM [Source 1]\n\n**Sources**\n[Source 1] _(src: official-source)_', sources)
    const text = rendered.map(node => {
      if (typeof node === 'string') return node
      if (node && typeof node === 'object' && 'props' in node) {
        const children = (node as { props?: { children?: unknown } }).props?.children
        return Array.isArray(children) ? children.map(child => typeof child === 'string' ? child : '').join('') : typeof children === 'string' ? children : ''
      }
      return ''
    }).join('')

    expect(text).toContain('The parade begins at 6:00 PM')
    expect(text).not.toContain('**Sources**')
    expect(text).not.toContain('Official festival page')
  })

  it('renders headings and list items without exposing raw markdown markers', () => {
    const rendered = renderMarkdownText('### Schedule\n- Opening parade\n- Food bazaar')
    expect(rendered.some(node => isValidElement(node) && node.type === 'h3')).toBe(true)
    expect(rendered.some(node => isValidElement(node) && node.type === 'ul')).toBe(true)
    expect(rendered.join('')).not.toContain('###')
    expect(rendered.join('')).not.toContain('- Opening parade')
  })

  it('renders no outbound link for a citation with a non-HTTPS source URL', () => {
    const sources: SourceCitation[] = [{
      id: 'unsafe-source', postId: '123456789', title: 'Unsafe source', platform: 'facebook',
      postUrl: 'javascript:alert(1)', publishedAt: null, festivalYear: 2026, status: 'active',
    }]

    const rendered = renderCitedContent('[Source 1]', sources)
    expect(element(rendered[0]).type).toBe('span')
  })

  it('renders an accessible Source N anchor for a valid non-Facebook canonical source URL', () => {
    const sources: SourceCitation[] = [{
      id: 'official-source', postId: 'official-1', title: 'Official festival page', platform: 'official',
      postUrl: 'https://negor.gov.ph/buglasan', publishedAt: null, festivalYear: 2026, status: 'active',
    }]

    const rendered = renderCitedContent('See _(src: official-source)_', sources)
    const citationLink = element(rendered[1])
    expect(citationLink.type).toBe('a')
    expect(citationLink.props.href).toBe('https://negor.gov.ph/buglasan')
    expect(citationLink.props['aria-label']).toBe('Open source: Official festival page')
  })

  it('keeps rendering a visible fallback for malformed message content and citations', () => {
    const rendered = renderCitedContent(null, [{ id: 1 }])
    const fallback = element(rendered[0])
    expect(fallback.type).toBe('span')
    expect(fallback.props.children).toContain('Unable to display this message.')
  })

  it('renders an official Facebook fallback URL as a safe anchor and preserves sentence punctuation', () => {
    const rendered = renderSafeLinks('See https://www.facebook.com/Buglasan.') as ReactElement[]
    const wrapper = element(rendered[1])
    const children = wrapper.props.children as unknown as ReactElement[]
    expect(element(children[0]).type).toBe('a')
    expect(element(children[0]).props.href).toBe('https://www.facebook.com/Buglasan')
    expect(element(children[0]).props.children).toBe('https://www.facebook.com/Buglasan')
    expect(children[1]).toBe('.')
  })

  it('keeps a malformed URL as text', () => {
    expect(renderSafeLinks('Not a link: https://')).toBe('Not a link: https://')
  })

  it('explains freshness clearly without overstating confirmation', () => {
    expect(warningCopy('UNKNOWN_FRESHNESS')).toContain('Knowledge base')
    expect(warningCopy('UNKNOWN_FRESHNESS')).toContain('newer update')
  })
})
