import { BRAND_PROPERTIES, type BrandTokens, type TenantBranding } from './types'

/**
 * `#RRGGBB` and nothing else.
 *
 * Deliberately the same expression as the backend's `BrandPalette::HEX`, anchored at
 * both ends with no allowance for whitespace or a trailing newline. JavaScript's `$`
 * does not have PHP's newline quirk, but the pattern is written to look identical so
 * that anyone comparing the two can see they agree.
 */
const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Turn the API's branding block into CSS custom properties.
 *
 * THIS FUNCTION DOES NO COLOUR MATHS, AND THAT IS THE POINT. Contrast is computed
 * once, server-side, by App\Support\Branding\BrandPalette, and arrives here already
 * decided. A second implementation in TypeScript would be a second answer to the
 * same question, free to disagree with the first — and the question is "is this
 * dosage instruction readable", which is not a good place for two opinions.
 *
 * What it does do is REFUSE anything that is not a plain hex triplet. That is belt
 * and braces rather than the control: the real control is that the API validates on
 * entry and will not store a non-hex value. But this string is about to become a CSS
 * custom property, and "it was validated when it was written" is a claim about
 * history rather than about this string.
 *
 * A value that fails is dropped, not defaulted and not passed through. Dropping it
 * means the stylesheet's own fallback applies and the page renders in Carevelo's
 * colours — visibly wrong to whoever configured it, which is the right failure. A
 * partially-applied palette is not.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export function resolveBrandTokens(branding: TenantBranding | null | undefined): BrandTokens {
  if (!branding) {
    return {}
  }

  const candidates: Record<string, unknown> = {
    '--brand-primary': branding.primary_colour,
    '--brand-primary-fg': branding.primary_foreground,
    '--brand-secondary': branding.secondary_colour,
    '--brand-secondary-fg': branding.secondary_foreground,
    '--brand-surface': branding.surface,
  }

  const tokens: BrandTokens = {}

  for (const property of BRAND_PROPERTIES) {
    const value = candidates[property]

    if (typeof value === 'string' && HEX.test(value)) {
      tokens[property] = value
    }
  }

  return tokens
}

/**
 * Whether a branding block is complete enough to theme a page with.
 *
 * A clinic mid-onboarding may have picked one colour and not the other. The portal
 * still has to render, so this reports rather than throws — the caller decides
 * whether to show the clinic's colours or fall back to neutral chrome.
 */
export function isFullyBranded(tokens: BrandTokens): boolean {
  return BRAND_PROPERTIES.every((property) => property in tokens)
}
