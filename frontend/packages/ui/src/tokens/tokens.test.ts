import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BRAND_PROPERTIES } from '../brand/types'

/*
 * The token layer, checked the way CSS cannot check itself.
 *
 * A misspelled custom property is the quietest bug in a stylesheet: `var(--hairlne)`
 * resolves to nothing, the border disappears, and no tool complains. There is no
 * type system here, so these are the tests that stand in for one.
 *
 * The import-order test matters for the same reason. The layers are ordered by
 * dependency — colours and metrics define the properties every later layer reads —
 * and getting it wrong produces a page that renders with half its variables unset,
 * which looks like a design problem rather than a build one.
 */

const DIR = fileURLToPath(new URL('.', import.meta.url))

function css(file: string): string {
  return readFileSync(join(DIR, file), 'utf8')
}

function allTokenFiles(): string[] {
  return readdirSync(DIR).filter((f: string) => f.endsWith('.css') && f !== 'index.css')
}

function definitions(source: string): Set<string> {
  return new Set(source.match(/^\s*(--[a-z0-9-]+)\s*:/gm)?.map((m) => m.trim().replace(/\s*:$/, '')) ?? [])
}

function references(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1] as string),
  )
}

describe('the token layer', () => {
  it('never references a custom property it does not define', () => {
    // The whole point. A typo here is invisible at runtime.
    const defined = new Set<string>()
    const used = new Map<string, string>()

    for (const file of allTokenFiles()) {
      const source = css(file)

      for (const token of definitions(source)) {
        defined.add(token)
      }

      for (const token of references(source)) {
        used.set(token, file)
      }
    }

    const dangling = [...used.entries()]
      .filter(([token]) => !defined.has(token))
      .map(([token, file]) => `${token} (referenced in ${file})`)

    expect(dangling).toEqual([])
  })

  it('imports the layers in dependency order', () => {
    // colors and the metric layers define what everything after them reads, so a
    // component layer pulled in first resolves its variables to nothing.
    const order = [...css('index.css').matchAll(/@import '\.\/([a-z]+)\.css'/g)].map(
      (m) => m[1],
    )

    expect(order).toEqual(['colors', 'typography', 'spacing', 'reset', 'components', 'layout', 'site', 'auth'])
  })

  it('imports every token file, so none is dead', () => {
    const imported = new Set(
      [...css('index.css').matchAll(/@import '\.\/([a-z]+\.css)'/g)].map((m) => m[1] as string),
    )

    expect([...allTokenFiles()].sort()).toEqual([...imported].sort())
  })

  it('defines a fallback for every brand property the API can set', () => {
    // A brand property with no fallback renders as nothing before a tenant resolves,
    // and on staff surfaces that are never clinic-branded at all.
    const defined = definitions(css('colors.css'))

    for (const property of BRAND_PROPERTIES) {
      expect(defined.has(property)).toBe(true)
    }
  })

  it('loads no webfont, because the patient portal cannot afford one', () => {
    // frontend-nextjs.md: "No web fonts on the critical path; system font stack."
    // The reference design system this is ported from imports Poppins from Google
    // Fonts; that would cost a render-blocking round trip before a patient on 3G can
    // see whether their appointment is confirmed.
    for (const file of allTokenFiles()) {
      const source = css(file)

      expect(source).not.toMatch(/@font-face/)
      expect(source).not.toMatch(/fonts\.googleapis\.com/)
      expect(source).not.toMatch(/@import url\(/)
    }
  })

  it('never hard-codes a foreground onto a brand-coloured surface', () => {
    // .btn-brand must use var(--brand-primary-fg), which the API computed for WCAG
    // AA. A literal #fff there is exactly the defect the backend's colour sweep
    // exists to prevent: a clinic with a pale brand gets unreadable button text.
    const source = css('components.css')
    const brandBlocks = [...source.matchAll(/\.btn-brand\s*\{[^}]*\}/g)].map((m) => m[0])

    expect(brandBlocks.length).toBeGreaterThan(0)

    for (const block of brandBlocks) {
      expect(block).toContain('var(--brand-primary-fg)')
      expect(block).not.toMatch(/color:\s*#/)
    }
  })

  it('keeps every interactive target at or above the touch floor', () => {
    // Sized for real thumbs: a clinician one-handed between rooms, a patient on a
    // cracked screen. Buttons and inputs declare min-height from the token rather
    // than a literal, so raising the floor is one edit.
    const source = css('components.css')

    for (const selector of ['.btn', '.input, .select, .textarea', '.tab']) {
      const block = source.match(
        new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`),
      )?.[0]

      expect(block, `${selector} not found`).toBeDefined()
      expect(block).toContain('min-height: var(--touch-min)')
    }
  })
})
