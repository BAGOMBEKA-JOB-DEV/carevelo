/**
 * The clinic's colours, on the way IN.
 *
 * ------------------------------------------------------------
 * THERE IS NO COLOUR MATHS IN THIS FILE, AND THERE MUST NOT BE.
 *
 * Contrast is computed once, server-side, by `App\Support\Branding\BrandPalette`, and it
 * arrives already decided: `primary_foreground` is `#FFFFFF` or `#000000` and nothing
 * else, and `contrast_advisories` is the guidance that goes with it. A second
 * implementation in TypeScript would be a second answer to the same question, free to
 * disagree with the first — and the question is "is this dosage instruction readable",
 * which is not a good place for two opinions. `packages/ui/src/brand/resolveBrandTokens.ts`
 * says the same thing about the same maths, and this file is the administrator-side half
 * of that rule.
 *
 * So what is here is validation and formatting, and the live preview in
 * `components/BrandingEditor.tsx` shows the clinic's colour on the surfaces it lands on
 * WITHOUT deciding what colour the text on top of it should be. It cannot know, and
 * guessing would make the preview a lie on exactly the case the preview exists for.
 */

/**
 * `#RRGGBB` and nothing else.
 *
 * Deliberately the same expression as the backend's `BrandPalette::HEX`, anchored at both
 * ends. Anchoring is the whole rule: an unanchored pattern matches the valid prefix of
 * `#ff0000; background:url(https://evil/x)` and waves the rest through.
 *
 * This is not the control — the API validates on entry and refuses to store anything else,
 * and React sets custom properties through the CSSOM so there is no string for a hostile
 * value to break out of. This is so the administrator finds out before the round trip.
 */
export const HEX = /^#[0-9a-fA-F]{6}$/

/** The same pattern as a string, for an `<input pattern>` — which is anchored implicitly. */
export const HEX_PATTERN = '#[0-9a-fA-F]{6}'

/**
 * What a typed colour becomes on the wire, or `null` for "the clinic has no such colour".
 *
 * An empty box means REMOVE IT, and that is a decision the administrator can legitimately
 * make: a clinic mid-onboarding may have one colour and not the other, and the portal
 * still has to render. `resolveBrandTokens` drops a missing token so the stylesheet's own
 * fallback applies and the page renders in Carevelo's colours — visibly wrong to whoever
 * configured it, which is the right failure. A partially-applied palette is not.
 *
 * Anything that is neither empty nor a hex triplet is returned UNCHANGED rather than
 * dropped, so the API refuses it and answers with its own sentence. Silently discarding a
 * mistyped colour is how an administrator comes to believe they saved something they did
 * not.
 */
export function colourFromForm(value: string | null): string | null {
  const trimmed = (value ?? '').trim()

  return trimmed === '' ? null : trimmed
}

/**
 * A colour for a swatch, or `undefined` where there is nothing to show.
 *
 * Re-validated even though it came from the API, for the reason `resolveBrandTokens` gives:
 * "it was validated when it was written" is a claim about history rather than about this
 * string, and this string is about to become a CSS custom property.
 */
export function swatch(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && HEX.test(value) ? value : undefined
}
