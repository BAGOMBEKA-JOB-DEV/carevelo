import { resolveBrandTokens } from './resolveBrandTokens'
import type { BrandTokens, TenantBranding } from './types'

/**
 * The clinic's colours as a React `style` object for the `<html>` element.
 *
 * THIS IS THE PATH THAT MATTERS. The patient portal resolves its tenant from the
 * Host header before render, and the branding has to be in the first HTML byte: a
 * flash of Carevelo colours where the clinic's should be tells the patient, correctly,
 * that they are dealing with a stranger — and that is the entire proposition of a
 * white-label product.
 *
 * So this returns a value for the server render. It is not `applyBrand` in an effect,
 * because an effect runs after paint, which is the flash.
 *
 * A React style OBJECT rather than a string, deliberately. React sets these through
 * the CSSOM, so no tenant value is ever concatenated into a `<style>` block or handed
 * to `dangerouslySetInnerHTML` — there is no string for a hostile value to break out
 * of. Combined with the hex validation in resolveBrandTokens, and with the API
 * refusing to store a non-hex value in the first place, that is three independent
 * reasons a colour cannot become a script. Acceptance criterion 1 is "no tenant-
 * supplied value can inject CSS, HTML or JavaScript into any rendered page", and
 * "we validated it" alone is a thinner answer than "there is nowhere for it to go".
 *
 * @example
 * // app/layout.tsx
 * <html style={brandStyle(tenant.branding)}>
 */
export function brandStyle(
  branding: TenantBranding | null | undefined,
): Record<string, string> {
  return resolveBrandTokens(branding)
}

/**
 * The same tokens, for a caller that already resolved them.
 */
export function tokensToStyle(tokens: BrandTokens): Record<string, string> {
  return { ...tokens }
}
