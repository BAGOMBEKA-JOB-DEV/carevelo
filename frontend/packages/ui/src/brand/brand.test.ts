import { describe, expect, it } from 'vitest'
import { applyBrand } from './applyBrand'
import { brandStyle } from './brandStyle'
import { isFullyBranded, resolveBrandTokens } from './resolveBrandTokens'
import { BRAND_PROPERTIES, type TenantBranding } from './types'

/*
 * White-labeling is the product, so these tests are about two promises.
 *
 * Acceptance criterion 1: "No tenant-supplied value can inject CSS, HTML or
 * JavaScript into any rendered page. Covered by test with hostile inputs." That is
 * this file's first half, and the inputs below are real attempts to escape a
 * declaration rather than decorative nonsense.
 *
 * Acceptance criterion 7: "Branding is server-rendered with no flash of unbranded
 * content." That is the second half — and the reason brandStyle returns a value for
 * the server render instead of applyBrand running in an effect.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */

function branding(overrides: Partial<TenantBranding> = {}): TenantBranding {
  return {
    primary_colour: '#1B7F5A',
    primary_foreground: '#FFFFFF',
    secondary_colour: '#0A2540',
    secondary_foreground: '#FFFFFF',
    surface: '#F1F8F5',
    logo_url: null,
    ...overrides,
  } as TenantBranding
}

describe('resolveBrandTokens', () => {
  it('maps a complete branding block to the documented custom properties', () => {
    const tokens = resolveBrandTokens(branding())

    expect(Object.keys(tokens).sort()).toEqual([...BRAND_PROPERTIES].sort())
    expect(tokens['--brand-primary']).toBe('#1B7F5A')
    expect(tokens['--brand-primary-fg']).toBe('#FFFFFF')
    expect(isFullyBranded(tokens)).toBe(true)
  })

  it('returns nothing for a tenant with no branding yet', () => {
    expect(resolveBrandTokens(null)).toEqual({})
    expect(resolveBrandTokens(undefined)).toEqual({})
    expect(isFullyBranded({})).toBe(false)
  })

  it('drops a refused value rather than defaulting it', () => {
    // A dropped token means the stylesheet's own fallback applies, so the page
    // renders in Carevelo's colours — visibly wrong to whoever configured it, which
    // is the right failure. Substituting a guess would hide the misconfiguration.
    const tokens = resolveBrandTokens(branding({ primary_colour: 'rebeccapurple' }))

    expect(tokens['--brand-primary']).toBeUndefined()
    expect(tokens['--brand-secondary']).toBe('#0A2540')
    expect(isFullyBranded(tokens)).toBe(false)
  })

  // THE branding security test.
  it.each([
    ['style escape', '#FF0000;}</style><script>alert(1)</script>'],
    ['declaration break', '#FF0000; background: url(https://evil.test/x)'],
    ['comment escape', '#FF0000 /* } body { display:none } */'],
    ['url function', 'url(https://evil.test/beacon.png)'],
    ['expression', 'expression(alert(1))'],
    ['var reference', 'var(--brand-primary-fg)'],
    ['important flag', '#FF0000 !important'],
    ['colour keyword', 'red'],
    ['rgb function', 'rgb(255,0,0)'],
    ['shorthand hex', '#F00'],
    ['eight-digit hex', '#FF0000FF'],
    ['non-hex digits', '#GGGGGG'],
    ['leading whitespace', ' #FF0000'],
    ['trailing whitespace', '#FF0000 '],
    ['trailing newline', '#FF0000\n'],
    ['newline then rule', '#FF0000\n} html { opacity: 0 }'],
    ['empty string', ''],
    ['missing hash', 'FF0000'],
  ])('refuses %s', (_name, hostile) => {
    const tokens = resolveBrandTokens(branding({ primary_colour: hostile }))

    expect(tokens['--brand-primary']).toBeUndefined()
  })

  it('refuses a non-string even though the type forbids it', () => {
    // The type says string | null. Types are a compile-time promise and this value
    // arrives over HTTP at runtime, so the check is a runtime one.
    for (const hostile of [123456, true, {}, ['#FF0000'], () => '#FF0000']) {
      const tokens = resolveBrandTokens(
        branding({ primary_colour: hostile as unknown as string }),
      )

      expect(tokens['--brand-primary']).toBeUndefined()
    }
  })
})

describe('brandStyle', () => {
  it('produces a style object, so no tenant value is ever concatenated into markup', () => {
    // React sets these through the CSSOM. There is no string for a hostile value to
    // break out of, which is a stronger guarantee than validation alone.
    const style = brandStyle(branding())

    expect(style).toEqual({
      '--brand-primary': '#1B7F5A',
      '--brand-primary-fg': '#FFFFFF',
      '--brand-secondary': '#0A2540',
      '--brand-secondary-fg': '#FFFFFF',
      '--brand-surface': '#F1F8F5',
    })
  })

  it('is empty for an unbranded tenant, leaving the stylesheet defaults', () => {
    expect(brandStyle(null)).toEqual({})
  })
})

describe('applyBrand', () => {
  function fakeRoot() {
    const set = new Map<string, string>()

    return {
      style: {
        setProperty: (k: string, v: string) => void set.set(k, v),
        removeProperty: (k: string) => void set.delete(k),
      },
      read: () => Object.fromEntries(set),
    }
  }

  it('sets each validated property on the root element', () => {
    const root = fakeRoot()

    const applied = applyBrand(branding(), root as unknown as HTMLElement)

    expect(applied).toBe(5)
    expect(root.read()['--brand-primary']).toBe('#1B7F5A')
  })

  it('clears a previous clinic rather than leaving its colours behind', () => {
    // Switching tenants inside one document — an admin previewing, a client-side
    // navigation — must not inherit the last clinic's palette.
    const root = fakeRoot()

    applyBrand(branding(), root as unknown as HTMLElement)
    const applied = applyBrand(null, root as unknown as HTMLElement)

    expect(applied).toBe(0)
    expect(root.read()).toEqual({})
  })

  it('reports zero when every value was refused, rather than failing silently', () => {
    const root = fakeRoot()

    const applied = applyBrand(
      {
        primary_colour: 'red',
        primary_foreground: 'white',
        secondary_colour: 'blue',
        secondary_foreground: 'black',
        surface: 'transparent',
        logo_url: null,
      } as unknown as TenantBranding,
      root as unknown as HTMLElement,
    )

    expect(applied).toBe(0)
    expect(root.read()).toEqual({})
  })

  it('does nothing without a document, so a server render cannot crash on it', () => {
    expect(applyBrand(branding(), undefined)).toBe(0)
  })
})
