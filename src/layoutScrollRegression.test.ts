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

/**
 * Wide-screen desktop shell + content-rail contract.
 *
 * The reported bug: the entire sidebar+main body was wrapped in an `mx-auto` +
 * 1440px max-width cap, so on viewports wider than 1440px the app body was centered with
 * exterior gutters (body gradient bleeding past hard vertical edges), the sidebar
 * looked detached, and the main content rail sat on a different axis from the
 * full-bleed Facebook strip / footer — the fix removes the outer cap so the shell
 * consumes the viewport and a single shared .content-rail centers the readable column.
 */
describe('wide-screen desktop shell layout contract', () => {
  it('does not cap the outer app body with the former global max-width', () => {
    expect(app).not.toMatch(/max-w-\[1440px\]/)
    expect(app).toMatch(/<div className="flex min-h-0 w-full flex-1">/)
  })

  it('gives the main pane flexible sizing (min-width:0) so it fills the remaining space', () => {
    expect(app).toMatch(/<main className="flex min-h-0 min-w-0 flex-1/)
  })

  it('routes header, conversation, composer and error through one shared content rail', () => {
    expect(app).toMatch(/app-header\"><div className="content-rail/)
    expect(app).toMatch(/aria-live="polite"><div className="content-rail"/)
    expect(app).toMatch(/composer-dock\"><div className="content-rail"/)
    expect(app).toMatch(/errorMessage && <div className="content-rail/)
    // The rail constant must not be duplicated as ad-hoc max-w-3xl chains anymore.
    expect(app).not.toMatch(/max-w-3xl/)
  })

  it('defines .content-rail once, centered, at a human reading width', () => {
    const rail = /\.content-rail\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rail).toMatch(/margin-inline:\s*auto/)
    expect(rail).toMatch(/max-width:\s*48rem/)
  })

  it('keeps the mobile off-canvas sidebar rule intact', () => {
    const mobileQueryIndex = css.indexOf('@media (max-width: 767px)')
    expect(mobileQueryIndex).toBeGreaterThan(-1)
    const mobileCss = css.slice(mobileQueryIndex)
    expect(mobileCss).toMatch(/\.history-sidebar\s*\{[^}]*-translate-x-full/)
    expect(mobileCss).toMatch(/\.history-sidebar\.is-open\s*\{[^}]*translate-x-0/)
  })
})
