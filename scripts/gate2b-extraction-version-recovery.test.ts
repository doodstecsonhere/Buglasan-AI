import { describe, expect, it } from 'vitest'
import { admittedSourceIds, eligibleForVersionRecovery, OLD_EXTRACTOR_VERSION, RECOVERY_EXTRACTOR_VERSION } from './gate2b-extraction-version-recovery.ts'

const source = { id: 'source', is_current: true, status: 'active', content_fingerprint: 'a'.repeat(64) }
const previous = { id: 'old', source_id: 'source', source_fingerprint: source.content_fingerprint, extractor_version: OLD_EXTRACTOR_VERSION, status: 'permanent_error', last_error_code: 'extraction_invalid_content' }

describe('Gate 2B extraction version recovery', () => {
  it('allows only the exact current permanent tuple and no replacement tuple', () => {
    expect(eligibleForVersionRecovery(source, previous, undefined)).toBe(true)
    expect(eligibleForVersionRecovery({ ...source, is_current: false }, previous, undefined)).toBe(false)
    expect(eligibleForVersionRecovery({ ...source, content_fingerprint: 'b'.repeat(64) }, previous, undefined)).toBe(false)
    expect(eligibleForVersionRecovery(source, { ...previous, status: 'extracted' }, undefined)).toBe(false)
    expect(eligibleForVersionRecovery(source, previous, { ...previous, id: 'new', extractor_version: RECOVERY_EXTRACTOR_VERSION })).toBe(false)
  })

  it('requires one of the diagnosed permanent error codes', () => {
    expect(eligibleForVersionRecovery(source, { ...previous, last_error_code: 'extraction_timeout' }, undefined)).toBe(false)
    expect(eligibleForVersionRecovery(source, { ...previous, last_error_code: 'extraction_unknown_failure' }, undefined)).toBe(true)
    expect(eligibleForVersionRecovery(source, { ...previous, last_error_code: 'extraction_invalid_structure' }, undefined)).toBe(true)
  })

  it('requires exactly the 27 existing IDs from the execution artifact', () => {
    const ids = Array.from({ length: 27 }, (_, index) => `id-${index}`)
    expect(admittedSourceIds({ outcomes: ids.map((sourceId) => ({ dispatch: { sourceId } })) })).toEqual(ids)
    expect(() => admittedSourceIds({ outcomes: ids.slice(0, 26).map((sourceId) => ({ dispatch: { sourceId } })) })).toThrow()
    expect(() => admittedSourceIds({ outcomes: [...ids.slice(0, 26), ids[0]].map((sourceId) => ({ dispatch: { sourceId } })) })).toThrow()
  })
})