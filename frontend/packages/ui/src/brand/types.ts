import type { components } from '@carevelo/api-client'

/**
 * The clinic's branding, exactly as `GET /v1/tenant` returns it.
 *
 * Taken from the generated schema rather than re-declared, so the shape cannot
 * drift from the contract. Note what the type already gives us: the API types the
 * foregrounds as `"#FFFFFF" | "#000000" | null`, so a third value is not
 * expressible here — the WCAG choice is made server-side by BrandPalette and this
 * side cannot second-guess it.
 */
export type TenantBranding = NonNullable<
  components['schemas']['TenantResource']
>['branding']

/**
 * The CSS custom properties a clinic's branding maps to.
 *
 * The names are fixed by white-labeling-and-branding.md. This list is the ENTIRE
 * surface a clinic can influence: colours and a logo, and nothing that could carry
 * CSS, markup or a font choice. That absence is the control, not an omission —
 * free-form styling in a multi-tenant health application is an exfiltration vector
 * for special-category data.
 */
export const BRAND_PROPERTIES = [
  '--brand-primary',
  '--brand-primary-fg',
  '--brand-secondary',
  '--brand-secondary-fg',
  '--brand-surface',
] as const

export type BrandProperty = (typeof BRAND_PROPERTIES)[number]

/** A validated, ready-to-apply set of custom properties. */
export type BrandTokens = Partial<Record<BrandProperty, string>>
