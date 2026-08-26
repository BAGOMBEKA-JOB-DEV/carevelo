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
 *
 * That order is also why each layer must own its selectors outright. Equal specificity
 * across two layers is decided by import order alone, silently, in favour of whichever
 * file happens to come later — so a name reused in a second layer is not an override
 * anyone asked for, it is a rule quietly replacing one somewhere else in the product.
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

/* The eight layers, in the order the browser sees them. Read from index.css rather than
   listed here, so a layer added tomorrow is checked without anyone remembering to. */
function layers(): string[] {
  return [...css('index.css').matchAll(/@import '\.\/([a-z]+\.css)'/g)].map((m) => m[1] as string)
}

type Rule = { selectors: string[]; body: string; depth: number }

/* Enough of a CSS reader for our own eight files, and no dependency to pull in: strip
   the comments, walk the braces, and hand back every rule's selector list, its
   declarations, and how deep it sits — depth 0 meaning a plain rule rather than one
   wrapped in an @media. */
function rules(source: string): Rule[] {
  const found: Rule[] = []
  const open: (Rule | null)[] = []
  let prelude = ''

  for (const character of source.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (character === '{') {
      const head = prelude.trim().replace(/\s+/g, ' ')

      if (head.startsWith('@') || head === '') {
        open.push(null)
      } else {
        const rule: Rule = {
          selectors: head.split(',').map((s) => s.trim()).filter(Boolean),
          body: '',
          depth: open.length,
        }
        found.push(rule)
        open.push(rule)
      }

      prelude = ''
    } else if (character === '}') {
      open.pop()
      prelude = ''
    } else {
      prelude += character
      const current = open[open.length - 1]
      if (current) current.body += character
    }
  }

  return found
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

    /*
     * `media` sits between `components` and `layout`, and the position is a decision.
     *
     * It reads the colour and metric tokens like every other component layer, so it cannot
     * come before them. It must come before `layout` for the same reason `components` does:
     * the two have collided before — `.field` meant a form row in one file and a page frame
     * in the other, identical specificity, later import won, and every form in the product
     * silently became a 100vh column. Nothing in `media` shares a name with anything (every
     * selector is `.media-*`), and the collision test below is what keeps that true rather
     * than this ordering.
     */
    expect(order).toEqual(['colors', 'typography', 'spacing', 'reset', 'components', 'media', 'layout', 'site', 'auth'])
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

  it('never lets two layers claim the same selector', () => {
    // This one already bit us. components.css owned `.field` as the form row; layout.css
    // reused the name for the rider's page frame. layout is imported later, the
    // specificity is identical, so layout won -- and every form field in the product
    // became a 100vh, 560px-wide centred column. On the sign-in page that put the
    // password input and the submit button a full viewport below the fold, and it
    // shipped, because nothing in CSS or the build has an opinion about two files
    // spelling a class the same way. This does.
    //
    // :root is the one deliberate overlap: colours, typography and spacing each layer
    // their own custom properties onto it, which is the point of having layers at all.
    const layered = new Set([':root', ":root[data-theme='dark']"])
    const owner = new Map<string, string>()
    const collisions: string[] = []

    for (const layer of layers()) {
      const claimed = new Set(
        rules(css(layer))
          .filter((rule) => rule.depth === 0)
          .flatMap((rule) => rule.selectors),
      )

      for (const selector of claimed) {
        if (layered.has(selector)) continue

        const held = owner.get(selector)

        // Named on both sides, because the whole value of this test is that whoever
        // trips it can see the collision without going looking for it.
        if (held) collisions.push(`${selector} is claimed by both ${held} and ${layer}`)
        else owner.set(selector, layer)
      }
    }

    expect(collisions).toEqual([])
  })

  it('never sizes a form primitive to the viewport', () => {
    // The same bug caught by its shape rather than by its name, in case the next one
    // arrives under a different class. A form control or button that is a viewport tall
    // pushes everything after it -- the next input, the submit button -- off the screen,
    // and a form whose button cannot be seen reads to the user as a form with no button.
    // Full-height belongs to page frames (.layout, .fieldview, .site), never to these.
    const primitives = ['.field', '.input', '.textarea', '.select', '.btn']
    const offenders: string[] = []

    for (const layer of layers()) {
      for (const rule of rules(css(layer))) {
        if (!/min-height:\s*100(?:v|dv|sv)h/.test(rule.body)) continue

        for (const primitive of rule.selectors.filter((s) => primitives.includes(s))) {
          offenders.push(`${primitive} is full-viewport in ${layer} (${rule.selectors.join(', ')})`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
