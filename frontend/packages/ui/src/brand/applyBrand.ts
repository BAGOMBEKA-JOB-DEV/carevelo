import { BRAND_PROPERTIES } from './types'
import { resolveBrandTokens } from './resolveBrandTokens'
import type { TenantBranding } from './types'

/**
 * Set the clinic's colours on the document at runtime.
 *
 * The client-side counterpart to `brandStyle`, and the lesser of the two. Use it
 * where branding genuinely changes after load — the admin previewing a colour while
 * choosing it, which is the case impala's reference implementation was built for
 * (`document.documentElement.style.setProperty('--primary', brandColor)`).
 *
 * DO NOT use it to brand the patient portal. Branding applied here lands after
 * paint, which is the flash of unbranded content the architecture forbids. That
 * surface uses `brandStyle` in the server render.
 *
 * setProperty, never a stylesheet. The value goes through the CSSOM as a property
 * value, so there is no declaration for it to escape from even before the hex
 * validation in resolveBrandTokens rejects it.
 *
 * @returns the number of properties applied — 0 means the branding was empty or
 *          every value was refused, which is worth surfacing rather than silently
 *          rendering unbranded.
 */
export function applyBrand(
  branding: TenantBranding | null | undefined,
  root: HTMLElement | undefined = globalThis.document?.documentElement,
): number {
  if (!root) {
    return 0
  }

  const tokens = resolveBrandTokens(branding)
  let applied = 0

  for (const property of BRAND_PROPERTIES) {
    const value = tokens[property]

    if (value === undefined) {
      // Cleared rather than left behind. Without this, switching from a branded
      // tenant to an unbranded one in the same document — an admin previewing, or a
      // client-side navigation — would keep the previous clinic's colours.
      root.style.removeProperty(property)

      continue
    }

    root.style.setProperty(property, value)
    applied++
  }

  return applied
}
