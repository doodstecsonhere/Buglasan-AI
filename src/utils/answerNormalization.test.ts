import { describe, expect, it } from 'vitest'
import {
  isolateSectionHeadings,
  matchStandaloneSectionHeading,
  normalizeAnswerMarkdown,
  separatePunctuationFromBold,
} from './answerNormalization'

describe('answer markdown normalization', () => {
  describe('punctuation-to-bold spacing', () => {
    it('inserts a space when a sentence ends against a bold sentence start', () => {
      expect(separatePunctuationFromBold('the target date.**So,** plan ahead')).toBe('the target date. **So,** plan ahead')
      expect(separatePunctuationFromBold('see you tomorrow.**If** it rains')).toBe('see you tomorrow. **If** it rains')
    })

    it('leaves prose without a bold sentence start untouched', () => {
      expect(separatePunctuationFromBold('a *italic* word and 3.14.**not a sentence')).toBe('a *italic* word and 3.14.**not a sentence')
    })

    it('is idempotent', () => {
      const once = separatePunctuationFromBold('date.**So,** done')
      expect(separatePunctuationFromBold(once)).toBe(once)
    })
  })

  describe('section heading separation', () => {
    it('pushes a bold heading glued to the previous paragraph onto its own block', () => {
      const input = 'The parade starts at 4 PM.**What this means for you**Plan to arrive early.'
      const output = isolateSectionHeadings(input)
      expect(output).toContain('4 PM.\n\n**What this means for you**\n\nPlan')
    })

    it('separates a plain canonical heading that follows a citation and rule', () => {
      const output = isolateSectionHeadings('Details [2] [3]---What this means for you')
      expect(output).toBe('Details [2] [3]---\n\nWhat this means for you')
    })

    it('does not add newlines when the heading already stands alone', () => {
      const input = 'Lead paragraph.\n\nWhat the sources tell us\n\nMore detail.'
      expect(isolateSectionHeadings(input)).toBe(input)
    })

    it('does not transform ordinary prose that merely contains the words', () => {
      const input = 'Here is what this means for you if the weather turns.'
      expect(isolateSectionHeadings(input)).toBe(input)
    })
  })

  describe('standalone heading detection', () => {
    it('recognizes bold and plain forms of a known heading', () => {
      expect(matchStandaloneSectionHeading('**What this means for you**')).toBe('What this means for you')
      expect(matchStandaloneSectionHeading('What the sources tell us')).toBe('What the sources tell us')
      expect(matchStandaloneSectionHeading('What this means for you:')).toBe('What this means for you')
    })

    it('rejects arbitrary lines and prose', () => {
      expect(matchStandaloneSectionHeading('**Festival schedule**')).toBeNull()
      expect(matchStandaloneSectionHeading('Some sentence about what this means for you')).toBeNull()
    })
  })

  it('applies both passes in a stable order', () => {
    const output = normalizeAnswerMarkdown('tomorrow.**If** you come.**What this means for you**arrive early')
    expect(output).toContain('tomorrow. **If**')
    expect(output).toContain('**What this means for you**\n\narrive early')
  })
})
