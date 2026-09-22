import { describe, expect, it } from 'vitest'
import {
  isolateSectionHeadings,
  matchStandaloneSectionHeading,
  normalizeAnswerMarkdown,
  separateBoldHeadingFromBody,
  separateEmphasisBoundaries,
  separateInlineBibliography,
  separatePunctuationFromBold,
} from './answerNormalization'

// The exact shape a production answer leaked with: every boundary whitespace was
// missing, so the heading, source note, citations and bibliography all shared lines.
const PRODUCTION_STYLE_BROKEN = [
  '**Buglasan Festival 2026 - End Date**The 2026 Buglasan Festival runs from **October 15 - October 25, 2026**. \u{1F389}',
  '',
  'The closing ceremony is scheduled for October 25.*Source: Official Buglasan Festival Facebook Page*[**[1]**](https://www.facebook.com/Buglasan/posts/1011)',
  '---**Sources** -[**[1]**](https://www.facebook.com/Buglasan/posts/1011)Facebook post, 18 Sep 2026',
].join('\n')

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

  describe('bold heading / body separation', () => {
    it('pushes a bold heading glued to its body onto its own block', () => {
      expect(separateBoldHeadingFromBody('**Buglasan Festival 2026 - End Date**The 2026 festival'))
        .toBe('**Buglasan Festival 2026 - End Date**\n\nThe 2026 festival')
    })

    it('leaves mid-sentence emphasis alone', () => {
      const input = 'It starts **today,** then the parade and **5** minutes of music.'
      expect(separateBoldHeadingFromBody(input)).toBe(input)
    })

    it('is idempotent', () => {
      const once = separateBoldHeadingFromBody('**Schedule**Opening parade')
      expect(separateBoldHeadingFromBody(once)).toBe(once)
    })
  })

  describe('emphasis boundary spacing', () => {
    it('gives an italic source note its own block', () => {
      const output = separateEmphasisBoundaries('scheduled for October 25.*Source: Official Page*')
      expect(output).toBe('scheduled for October 25.\n\n*Source: Official Page*')
    })

    it('never leaves an italic run flush against a citation that follows', () => {
      const output = separateEmphasisBoundaries('Note.*Remark*[Source 1]')
      expect(output).toBe('Note.*Remark* [Source 1]')
    })

    it('leaves ordinary inline emphasis untouched', () => {
      const input = 'A *bright* morning with [Source 2] nearby.'
      expect(separateEmphasisBoundaries(input)).toBe(input)
    })
  })

  describe('collapsed bibliography restoration', () => {
    it('splits a rule, heading and entry that shared one line', () => {
      const output = separateInlineBibliography('end of answer.---**Sources** -[**[1]**](https://x.test/1)Facebook post')
      expect(output.split('\n')).toEqual(['end of answer.', '', '---', '', '**Sources**', '', '-[**[1]**](https://x.test/1)Facebook post'])
    })

    it('splits further entries that shared the same collapsed line', () => {
      const output = separateInlineBibliography('**Sources** -[**[1]**](https://x.test/1)Post one -[**[2]**](https://x.test/2)Post two')
      expect(output.split('\n').filter(Boolean)).toEqual(['**Sources**', '-[**[1]**](https://x.test/1)Post one', '-[**[2]**](https://x.test/2)Post two'])
    })

    it('never breaks an inline citation away from the sentence it supports', () => {
      const input = 'The parade starts at 4 PM. [Source 1]\n\nMore answer prose.'
      expect(separateInlineBibliography(input)).toBe(input)
    })

    it('leaves prose that merely mentions sources untouched', () => {
      const input = 'The sources mention a parade on Friday.\n\nNothing else.'
      expect(separateInlineBibliography(input)).toBe(input)
    })
  })

  describe('production-style leaked answer', () => {
    const output = normalizeAnswerMarkdown(PRODUCTION_STYLE_BROKEN)

    it('separates the answer into readable blocks', () => {
      expect(output).toContain('**Buglasan Festival 2026 - End Date**\n\nThe 2026 Buglasan Festival')
      expect(output).toContain('\n\n*Source: Official Buglasan Festival Facebook Page* [**[1]**]')
    })

    it('restores the line structure the trailing bibliography needs', () => {
      const lines = output.split('\n')
      expect(lines).toContain('---')
      expect(lines).toContain('**Sources**')
      expect(lines.some((line) => /^-\[\*\*\[1\]\*\*\]\(https:\/\/www\.facebook\.com\/Buglasan\/posts\/1011\)/.test(line))).toBe(true)
      // The answer itself survives every pass.
      expect(output).toContain('The closing ceremony is scheduled for October 25.')
    })

    it('is idempotent', () => {
      expect(normalizeAnswerMarkdown(output)).toBe(output)
    })
  })
})
