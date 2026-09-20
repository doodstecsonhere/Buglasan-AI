import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { AIDisclaimer } from './AIDisclaimer'
import { productConfig } from '../config/productConfig'

const text = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(text).join('')
  if (value && typeof value === 'object' && 'props' in value) return text((value as { props?: { children?: unknown } }).props?.children)
  return ''
}

const markup = (value: unknown): string => JSON.stringify(value)

/** Every element in the rendered tree whose className contains the given token. */
const classHolders = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) classHolders(item, found)
    return found
  }
  if (value && typeof value === 'object') {
    const element = value as ReactElement<{ className?: string; children?: unknown }>
    if (typeof element.props?.className === 'string') found.push(element.props.className)
    classHolders(element.props?.children, found)
  }
  return found
}

/** The first element anywhere in the tree whose className contains the token. */
const findByClass = (value: unknown, token: string): ReactElement | null => {
  const nodes = Array.isArray(value) ? value : [value]
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const element = node as ReactElement<{ className?: string; children?: unknown }>
    if (typeof element.props?.className === 'string' && element.props.className.includes(token)) return element
    const nested = findByClass(element.props?.children, token)
    if (nested) return nested
  }
  return null
}

const assistantName = productConfig.identity.assistantName

describe('AIDisclaimer trust disclosure', () => {
  const output = text(AIDisclaimer())
  const tree = AIDisclaimer()

  it('keeps the AI-error disclaimer and the official Facebook link', () => {
    expect(output).toContain('AI can make mistakes.')
    expect(output).toContain('Check the official')
    expect(output).toContain(productConfig.officialSource.pageLabel)
    expect(markup(tree)).toContain(productConfig.officialSource.url)
  })

  it('leads with the independence fact using the short project wording', () => {
    expect(output).toContain('independent, unofficial project')
    // The old sentence that pushed the footer to three lines on mobile is gone.
    expect(output).not.toContain(productConfig.trust.aiDisclaimer)
  })

  it('keeps the mobile copy shorter than the desktop copy', () => {
    // Mobile drops the product name from the first sentence and the festival name
    // from the page label, so the footer stays a couple of quiet lines.
    expect(output).toContain('Independent, unofficial project.')
    expect(output).toContain('Facebook Page')
  })

  it('never leaves the link text able to orphan its final word', () => {
    // The anchor and the sentence-ending period share one nowrap wrapper, so "Page."
    // can never wrap onto a line of its own.
    const wrapper = ((tree as ReactElement<{ children?: unknown }>).props?.children as ReactElement<{ children?: unknown[] }>).props?.children ?? []
    expect(classHolders(wrapper).filter((className) => className.includes('whitespace-nowrap')).length).toBe(1)
    const nowrapSource = findByClass(tree, 'whitespace-nowrap')
    expect(nowrapSource).toBeTruthy()
    // The whole label (both responsive variants) and the closing period live inside the
    // single nowrap wrapper, so nothing after the link can be pushed onto its own line.
    const nowrapText = text(nowrapSource)
    expect(nowrapText).toContain(productConfig.officialSource.pageLabel)
    expect(nowrapText.endsWith('.')).toBe(true)
  })

  it('communicates the trust disclosure with only the primary sentence', () => {
    // The redundant "Data sourced from official channels. Not affiliated with …"
    // second line is no longer rendered on any breakpoint; the footer stays a
    // single quiet disclosure.
    expect(output).not.toContain('Data sourced from official channels.')
    expect(output).not.toContain('Not affiliated with the Provincial Government of Negros Oriental.')
    expect(output).not.toContain(productConfig.trust.nonAffiliationNotice)
    // The desktop paragraph carries the full primary sentence verbatim.
    expect(output).toContain(`${assistantName} is an independent, unofficial project. AI can make mistakes. Check the official`)
  })
})
