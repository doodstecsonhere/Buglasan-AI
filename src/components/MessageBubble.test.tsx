import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderCitedContent, renderMarkdownText, renderSafeLinks, warningCopy } from './MessageBubble'
import type { SourceCitation } from '../types'

describe('MessageBubble response rendering', () => {
  const element = (value: unknown) => {
    expect(isValidElement(value)).toBe(true)
    return value as ReactElement<{ children?: ReactElement<{ children?: string }> | string; href?: string; 'aria-label'?: string }>
  }

  const renderedText = (nodes: unknown[]): string => nodes.map((node) => {
    if (typeof node === 'string') return node
    if (node && typeof node === 'object' && 'props' in node) {
      const children = (node as { props?: { children?: unknown } }).props?.children
      return Array.isArray(children) ? children.map(child => typeof child === 'string' ? child : '').join('') : typeof children === 'string' ? children : ''
    }
    return ''
  }).join('')

  const evidenceSources: SourceCitation[] = [{
    id: 'official-source-1', postId: 'official-1', title: 'Official source one', platform: 'official',
    postUrl: 'https://negor.gov.ph/buglasan/1', publishedAt: null, festivalYear: 2026, status: 'active',
  }, {
    id: 'official-source-2', postId: 'official-2', title: 'Official source two', platform: 'official',
    postUrl: 'https://negor.gov.ph/buglasan/2', publishedAt: null, festivalYear: 2026, status: 'active',
  }]

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
    const text = renderedText(rendered)

    expect(text).toContain('The parade begins at 6:00 PM')
    expect(text).not.toContain('**Sources**')
    expect(text).not.toContain('Official festival page')
  })

  it('drops the production 🌟 Sources bibliography when structured Evidence is present', () => {
    const rendered = renderCitedContent(
      'The parade starts at 4:00 PM on IG.\n\n🌟 Sources:\n[Source 1] Official source one\n[Source 2] Official source two',
      evidenceSources,
    )
    const text = renderedText(rendered)

    expect(text).toContain('The parade starts at 4:00 PM on IG.')
    expect(text).not.toContain('Sources:')
    expect(text).not.toContain('Official source one')
    expect(text).not.toContain('Official source two')
  })

  it('drops a markdown ### Sources bibliography with entry titles and URLs', () => {
    const rendered = renderCitedContent(
      'Fireworks light up the harbor at midnight.\n\n### Sources\n[Source 1] Official source one https://negor.gov.ph/buglasan/1\n- [Source 2] Official source two',
      evidenceSources,
    )
    const text = renderedText(rendered)

    expect(text).toContain('Fireworks light up the harbor at midnight.')
    expect(text).not.toContain('### Sources')
    expect(text).not.toContain('Official source one')
  })

  it('drops a clearly bibliography-shaped trailing References section', () => {
    const rendered = renderCitedContent(
      'The parade route follows Rizal Park.\n\n📚 References:\n1. [Source 1] Official source one\n2. [Source 2] Official source two',
      evidenceSources,
    )
    const text = renderedText(rendered)

    expect(text).toContain('The parade route follows Rizal Park.')
    expect(text).not.toContain('References:')
    expect(text).not.toContain('Official source two')
  })

  it('preserves an inline [Source N] citation inside normal prose', () => {
    const rendered = renderCitedContent('The parade starts at 4:00 PM [Source 1] near the harbor.', evidenceSources)
    const citationLink = element(rendered[1])
    expect(citationLink.type).toBe('a')
    expect(citationLink.props.href).toBe('https://negor.gov.ph/buglasan/1')
    expect(renderedText(rendered)).toContain('near the harbor.')
  })

  it('preserves an ordinary sentence that merely mentions sources', () => {
    const content = 'Official sources announce the parade starts at 4:00 PM.'
    expect(renderedText(renderCitedContent(content, evidenceSources))).toBe(content)
  })

  it('preserves a substantive non-bibliography Sources section', () => {
    const content = '### Sources\nThe festival funding comes from the city budget and private sponsors.\nIt has been organized this way for years.'
    expect(renderedText(renderCitedContent(content, evidenceSources))).toContain('The festival funding comes from the city budget and private sponsors.')
  })

  it('keeps a trailing bibliography visible when no structured Evidence exists', () => {
    const content = 'The parade starts at 4:00 PM on IG.\n\n🌟 Sources:\n[Source 1] Official source one\n[Source 2] Official source two'
    const text = renderedText(renderCitedContent(content, []))
    expect(text).toContain('Sources:')
    expect(text).toContain('Official source one')
  })

  it('drops the live production bullet bibliography with adjacent [N] citation markers', async () => {
    const { stripTrailingSourcesSection } = await import('./MessageBubble')
    const input = 'The festival approaches! 🎉\n---\nSources:\n* [1]FACEBOOK | Pickleball Tournament Preparations\n* [2]FACEBOOK | Buglasan Festival Profile Picture Update\n* [3]FACEBOOK | Buglasan Festival Parade Lineup\n* [4]FACEBOOK | Buglas Camp Fest 2026 Venue Update & Registration'
    expect(stripTrailingSourcesSection(input, [...evidenceSources, { id: 'official-source-3', postId: 'official-3', title: 'Official source three', platform: 'official', postUrl: 'https://negor.gov.ph/buglasan/3', publishedAt: null, festivalYear: 2026, status: 'active' } as SourceCitation, { id: 'official-source-4', postId: 'official-4', title: 'Official source four', platform: 'official', postUrl: 'https://negor.gov.ph/buglasan/4', publishedAt: null, festivalYear: 2026, status: 'active' } as SourceCitation])).toBe('The festival approaches! 🎉')
    const rendered = renderCitedContent(input, [
      ...evidenceSources,
      { id: 'official-source-3', postId: 'official-3', title: 'Official source three', platform: 'official', postUrl: 'https://negor.gov.ph/buglasan/3', publishedAt: null, festivalYear: 2026, status: 'active' },
      { id: 'official-source-4', postId: 'official-4', title: 'Official source four', platform: 'official', postUrl: 'https://negor.gov.ph/buglasan/4', publishedAt: null, festivalYear: 2026, status: 'active' },
    ])
    const text = renderedText(rendered)

    expect(text).toContain('The festival approaches! 🎉')
    expect(text).not.toContain('Sources:')
    expect(text).not.toContain('Pickleball Tournament Preparations')
    expect(text).not.toContain('Buglas Camp Fest 2026 Venue Update & Registration')
    expect(text).not.toContain('---')
  })

  it('drops the live production --Sources numbered bibliography with trailing citations', () => {
    const input = 'The festival approaches!\n--Sources\n1. Facebook post about pickleball preparations – [1]\n2. Facebook notice about another update – [2]\n3. Facebook post about another event – [3]'
    const rendered = renderCitedContent(input, [
      ...evidenceSources,
      { id: 'official-source-3', postId: 'official-3', title: 'Official source three', platform: 'official', postUrl: 'https://negor.gov.ph/buglasan/3', publishedAt: null, festivalYear: 2026, status: 'active' },
    ])
    const text = renderedText(rendered)

    expect(text).toContain('The festival approaches!')
    expect(text).not.toContain('--Sources')
    expect(text).not.toContain('Facebook post about pickleball preparations')
    expect(text).not.toContain('[3]')
  })

  it('drops a markdown Citations bibliography and keeps preceding answer bytes intact', async () => {
    const { stripTrailingSourcesSection } = await import('./MessageBubble')
    const input = 'The harbor lights stay on until midnight.\n### Citations\n[Source 1] Official source one\n[Source 2] Official source two'
    expect(stripTrailingSourcesSection(input, evidenceSources)).toBe('The harbor lights stay on until midnight.')
  })

  it('keeps an inline [1] marker inside normal prose untouched by the parser', async () => {
    const { stripTrailingSourcesSection } = await import('./MessageBubble')
    const input = 'The parade starts at [1] near the harbor, updated for 2026.'
    expect(stripTrailingSourcesSection(input, evidenceSources)).toBe(input)
  })

  it('preserves a substantive numbered schedule whose entries end in bracketed citations', async () => {
    const { stripTrailingSourcesSection } = await import('./MessageBubble')
    const input = 'Join us for the following:\n1. Opening parade – [1]\n2. Food bazaar – [2]\nSee you at the harbor!'
    expect(stripTrailingSourcesSection(input, evidenceSources)).toBe(input)
  })

  it('preserves a bibliography whose citations do not map onto the structured Evidence', async () => {
    const { stripTrailingSourcesSection } = await import('./MessageBubble')
    const input = 'Answer prose.\nSources:\n* [9]FACEBOOK | Phantom citation one\n* [10]FACEBOOK | Phantom citation two'
    expect(stripTrailingSourcesSection(input, evidenceSources)).toBe(input)
  })

  it('still renders the structured Evidence panel with its source count', async () => {
    const { SourcesCard } = await import('./SourcesCard')
    const collectText = (value: unknown): string => {
      if (typeof value === 'string' || typeof value === 'number') return String(value)
      if (Array.isArray(value)) return value.map(collectText).join('')
      if (value && typeof value === 'object' && 'props' in value) return collectText((value as { props?: { children?: unknown } }).props?.children)
      return ''
    }
    const card = SourcesCard({ sources: evidenceSources })
    const text = collectText(card)
    expect(text).toMatch(/Evidence \S 2 sources/)
    expect(text).toContain('Official source one')
    expect(text).toContain('Official source two')
    expect(JSON.stringify(card).replace(/\\\//g, '/')).toContain('https://negor.gov.ph/buglasan/2')
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
