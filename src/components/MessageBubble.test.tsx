import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderCitedContent, renderMarkdownText, renderSafeLinks, stripTrailingSourcesSection, warningCopy, warningTone } from './MessageBubble'
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

  it('suppresses a fully collapsed production Markdown bibliography and maps its citation link to Evidence', () => {
    const sources: SourceCitation[] = [{
      id: 'fb-1011', postId: '1011', title: 'Buglasan Festival 2026 announcement', platform: 'facebook',
      postUrl: 'https://www.facebook.com/Buglasan/posts/1011', publishedAt: new Date('2026-09-18T00:00:00Z'), festivalYear: 2026, status: 'active',
    }]
    // Emitted with no boundary whitespace at all: heading glued to body, source note
    // glued to a citation link, and the whole terminal bibliography collapsed onto one line.
    const input = '**Buglasan Festival 2026 - End Date**The 2026 Buglasan Festival runs from **October 15 - October 25, 2026**. 🎉\n\nThe closing ceremony is scheduled for October 25.*Source: Official Buglasan Festival Facebook Page*[**[1]**](https://www.facebook.com/Buglasan/posts/1011)\n---**Sources** -[**[1]**](https://www.facebook.com/Buglasan/posts/1011)Facebook post, 18 Sep 2026'
    const rendered = renderCitedContent(input, sources)
    const text = renderedText(rendered)

    // Answer content survives; the terminal bibliography is gone.
    expect(text).toContain('The 2026 Buglasan Festival runs from')
    expect(text).toContain('The closing ceremony is scheduled for October 25.')
    expect(text).not.toContain('Facebook post, 18 Sep 2026')
    expect(text).not.toContain('**Sources**')
    // The decorative rule that introduced the bibliography is swallowed with it, even
    // after normalization pushed it onto its own line above the heading.
    expect(text).not.toContain('---')
    // The inline [**[1]**] citation link resolves to the trusted Evidence URL, not raw markup.
    const hrefs = JSON.stringify(rendered).replace(/\\\//g, '/')
    expect(hrefs).toContain('https://www.facebook.com/Buglasan/posts/1011')
    expect(text).not.toContain('](')
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

  it('Evidence lists each source once with a single Open source link, shows known dates and degrades unknown dates quietly', async () => {
    const { SourcesCard } = await import('./SourcesCard')
    const sources: SourceCitation[] = [
      { id: 'a', postId: 'a', title: 'Parade update', platform: 'facebook', postUrl: 'https://www.facebook.com/Buglasan/posts/1', publishedAt: new Date('2026-09-18T00:00:00Z'), festivalYear: 2026, status: 'active' },
      { id: 'b', postId: 'b', title: 'Venue note', platform: 'official', postUrl: 'https://negor.gov.ph/buglasan/venue', publishedAt: null, festivalYear: 2026, status: 'superseded' },
    ]
    const json = JSON.stringify(SourcesCard({ sources }))
    // Exactly one outbound link per source: the title is the single "Open source" action.
    const hrefs = [...json.matchAll(/"href":"(https:[^"]+)"/g)].map(match => match[1]).sort()
    expect(hrefs).toEqual(['https://negor.gov.ph/buglasan/venue', 'https://www.facebook.com/Buglasan/posts/1'])
    // The old duplicated "Open Source N" text link is gone.
    expect(json).not.toMatch(/Open Source \d/)
    // Known publication date rendered; unknown date omitted without an alarm label.
    expect(json).toContain('2026')
    expect(json).not.toMatch(/Publication date unknown/i)
    // "Current" is never a claim the interface makes; "Superseded" states a fact
    // about the source itself, so it stays.
    expect(json).not.toContain('Current')
    expect(json).toContain('Superseded')
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

  it('presents ordinary freshness uncertainty as calm, honest information rather than an alarm', () => {
    const copy = warningCopy('UNKNOWN_FRESHNESS')
    expect(copy).toMatch(/latest information/i)
    expect(copy).toMatch(/knowledge base/i)
    expect(copy).toMatch(/may exist/i)
    // Must not overstate confirmation nor imply live monitoring.
    expect(copy).not.toMatch(/could not confirm/i)
    expect(copy).not.toMatch(/monitor/i)
  })

  it('only treats genuine staleness as a warning, and uncertainty as informational', () => {
    expect(warningTone('UNKNOWN_FRESHNESS')).toBe('info')
    expect(warningTone('MIXED_FRESHNESS')).toBe('info')
    expect(warningTone('STALE_SOURCE')).toBe('warning')
    expect(warningTone('STALE_CORPUS')).toBe('warning')
  })

  describe('compound inline citations', () => {
    const collectAnchors = (nodes: unknown[]): ReactElement<{ href?: string }>[] => nodes.flatMap((node) => {
      if (!node || typeof node !== 'object') return []
      if (Array.isArray(node)) return collectAnchors(node)
      if (!isValidElement(node)) return []
      const children = (node.props as { children?: unknown }).children
      if (node.type === 'a') return [node as ReactElement<{ href?: string }>, ...collectAnchors(Array.isArray(children) ? children : [children])]
      return collectAnchors(Array.isArray(children) ? children : [children])
    })

    it('renders a comma-separated compound reference as two links instead of literal text', () => {
      const rendered = renderCitedContent('The parade and bazaar run together [Source 1, Source 2] today.', evidenceSources)
      const text = renderedText(rendered)
      expect(text).not.toContain('Source')
      expect(text).toContain('today.')
      const anchors = collectAnchors(rendered)
      expect(anchors).toHaveLength(2)
      expect(anchors.map(anchor => anchor.props.href)).toEqual(['https://negor.gov.ph/buglasan/1', 'https://negor.gov.ph/buglasan/2'])
    })

    it('renders an "and"-joined compound reference as links', () => {
      const rendered = renderCitedContent('Both stages are open [Source 1 and Source 2].', evidenceSources)
      const text = renderedText(rendered)
      expect(text).not.toContain('Source')
      expect(collectAnchors(rendered)).toHaveLength(2)
    })

    it('drops an out-of-range number from a compound reference but keeps the valid link', () => {
      const rendered = renderCitedContent('Details [Source 1, Source 9].', evidenceSources)
      const anchors = collectAnchors(rendered)
      expect(anchors).toHaveLength(1)
      expect(anchors[0].props.href).toBe('https://negor.gov.ph/buglasan/1')
    })

    it('leaves unrelated bracketed text untouched', () => {
      const rendered = renderCitedContent('Meet at [Note 1, Note 2] near the harbor.', evidenceSources)
      expect(renderedText(rendered)).toContain('[Note 1, Note 2]')
      expect(collectAnchors(rendered)).toHaveLength(0)
    })

    it('does not treat a bare numeric bracket as a citation', () => {
      const rendered = renderCitedContent('Reference [2, 3] is not a source link.', evidenceSources)
      expect(renderedText(rendered)).toContain('[2, 3]')
      expect(collectAnchors(rendered)).toHaveLength(0)
    })
  })

  describe('Unicode citation variants', () => {
    const collectLinks = (nodes: unknown[]): ReactElement<{ href?: string; 'aria-label'?: string }>[] => {
      const found: ReactElement<{ href?: string; 'aria-label'?: string }>[] = []
      const walk = (list: unknown[]) => {
        for (const node of list) {
          if (!node || typeof node !== 'object') continue
          if (Array.isArray(node)) { walk(node); continue }
          if (!isValidElement(node)) continue
          const children = (node.props as { children?: unknown }).children
          if (node.type === 'a') found.push(node as ReactElement<{ href?: string; 'aria-label'?: string }>)
          walk(Array.isArray(children) ? children : [children])
        }
      }
      walk(nodes)
      return found
    }

    it('renders a full-width bracketed single citation as one clickable link', () => {
      const rendered = renderCitedContent('Parade at 4 PM \u3010Source 1\u3011 today.', evidenceSources)
      const links = collectLinks(rendered)
      expect(links).toHaveLength(1)
      expect(links[0].props.href).toBe('https://negor.gov.ph/buglasan/1')
      expect(links[0].props['aria-label']).toBe('Open source: Official source one')
      const text = renderedText(rendered)
      expect(text).toContain('today.')
      expect(text).not.toContain('\u3010')
    })

    it('renders a full-width compound citation as two clickable links', () => {
      const rendered = renderCitedContent('Both stages open \u3010Source 1, Source 2\u3011.', evidenceSources)
      expect(collectLinks(rendered).map(link => link.props.href)).toEqual(['https://negor.gov.ph/buglasan/1', 'https://negor.gov.ph/buglasan/2'])
    })

    it('parses a full-width citation containing non-breaking whitespace', () => {
      const rendered = renderCitedContent('Info \u3010Source\u00A01\u3011 here.', evidenceSources)
      expect(collectLinks(rendered)).toHaveLength(1)
    })

    it('leaves an unrelated full-width bracket untouched', () => {
      const rendered = renderCitedContent('See \u3010Note 1\u3011 for details.', evidenceSources)
      expect(collectLinks(rendered)).toHaveLength(0)
      expect(renderedText(rendered)).toContain('\u3010Note 1\u3011')
    })

    it('drops an out-of-range number from a full-width compound reference', () => {
      const rendered = renderCitedContent('X \u3010Source 1, Source 9\u3011.', evidenceSources)
      const links = collectLinks(rendered)
      expect(links).toHaveLength(1)
      expect(links[0].props.href).toBe('https://negor.gov.ph/buglasan/1')
    })
  })

  it('suppresses a decorated ---**Sources** bibliography with plain entries', () => {
    const input = 'The fireworks start at 9 PM.\n---**Sources**\n1. Facebook post about the parade\n2. Facebook post about the concert'
    expect(stripTrailingSourcesSection(input, evidenceSources)).toBe('The fireworks start at 9 PM.')
    const text = renderedText(renderCitedContent(input, evidenceSources))
    expect(text).toContain('The fireworks start at 9 PM.')
    expect(text).not.toContain('Sources')
    expect(text).not.toContain('Facebook post about the parade')
  })

  it('renders a recognized section heading as its own block instead of glued prose', () => {
    const rendered = renderMarkdownText('The parade starts at 4 PM.\n\nWhat this means for you\n\nArrive early to get a good spot.')
    const heading = rendered.find(node => isValidElement(node) && node.type === 'h4')
    expect(heading).toBeTruthy()
    expect((heading as ReactElement<{ children?: string }>).props.children).toBe('What this means for you')
  })

  it('never shows a Current label, for dated or undated sources, but keeps superseded ones', async () => {
    const { SourcesCard } = await import('./SourcesCard')
    const sources = [
      { id: 'c', postId: 'c', title: 'Dated active', platform: 'facebook', postUrl: 'https://www.facebook.com/Buglasan/posts/9', publishedAt: new Date('2026-09-18T00:00:00Z'), festivalYear: 2026, status: 'active' },
      { id: 'd', postId: 'd', title: 'Undated active', platform: 'facebook', postUrl: 'https://www.facebook.com/Buglasan/posts/10', publishedAt: null, festivalYear: 2026, status: 'active' },
      { id: 'e', postId: 'e', title: 'Undated superseded', platform: 'official', postUrl: 'https://negor.gov.ph/x', publishedAt: null, festivalYear: 2026, status: 'superseded' },
    ] as unknown as SourceCitation[]
    const json = JSON.stringify(SourcesCard({ sources }))
    expect(json).not.toContain('Current')
    expect(json).toContain('Superseded')
    // The dated active source stays quiet; only the genuinely superseded source is labelled.
    expect((json.match(/Superseded/g) ?? []).length).toBe(1)
  })

  it('does not render an informational freshness banner but keeps a genuine stale warning', async () => {
    const { MessageBubble } = await import('./MessageBubble')
    const base = { id: 'answer', role: 'assistant' as const, content: 'Answer', timestamp: new Date() }
    const informational = JSON.stringify(MessageBubble({ message: { ...base, freshness: { warning: 'UNKNOWN_FRESHNESS' } as never }, showAvatar: false }))
    expect(informational).not.toContain('"role":"note"')
    const stale = JSON.stringify(MessageBubble({ message: { ...base, freshness: { warning: 'STALE_SOURCE' } as never }, showAvatar: false }))
    expect(stale).toContain('"role":"note"')
  })
})
