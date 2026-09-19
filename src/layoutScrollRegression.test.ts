import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Desktop wheel-scroll regression guard.
 *
 * The reported bug: on desktop the whole `.app-shell` grew with content while its
 * `overflow-hidden` ancestors trapped wheel scroll-chaining, so the page scrollbar
 * could be dragged but the mouse wheel did nothing. The fix gives the shell a
 * definite viewport height on every breakpoint so `.conversation-scroll`
 * (overflow-y-auto) becomes the single, bounded scroller.
 */
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'index.css'), 'utf8')
const app = readFileSync(join(here, 'App.tsx'), 'utf8')

describe('desktop scroll layout regression', () => {
  it('gives .app-shell a definite viewport height outside the mobile media query', () => {
    const mobileQueryIndex = css.indexOf('@media (max-width: 767px)')
    expect(mobileQueryIndex).toBeGreaterThan(-1)
    const baseCss = css.slice(0, mobileQueryIndex)
    const shellRule = /\.app-shell\s*\{[^}]*\}/.exec(baseCss)?.[0] ?? ''
    expect(shellRule).toMatch(/height:\s*100dvh/)
  })

  it('keeps one bounded scroller: overflow-hidden shell with an overflow-y-auto conversation', () => {
    expect(app).toMatch(/app-shell[^"]*overflow-hidden/)
    expect(app).toMatch(/conversation-scroll[^"`]*overflow-y-auto/)
  })
})
