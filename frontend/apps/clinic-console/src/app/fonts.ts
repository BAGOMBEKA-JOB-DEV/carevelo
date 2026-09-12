import localFont from 'next/font/local'

/**
 * The two self-hosted faces, and the two custom properties the whole product reads.
 *
 * THIS FILE EXISTS BECAUSE ITS ABSENCE WAS A SILENT FAILURE. The token layer names the
 * families and nothing else — `--font: 'Poppins', system-ui, …` and
 * `--head: 'Tex Gyre Adventor', 'Poppins', system-ui, …` — on the correct assumption that
 * the app loads the bytes. The patient portal did. This app did not, so both properties
 * fell through their entire fallback chain to system-ui, and every heading it renders at
 * weight 700 was the system font pretending to be a display face. Nothing reported it:
 * the CSS was valid, the cascade resolved, and `--head` had a working value. It was just
 * the wrong one, everywhere, since the surface was built.
 *
 * A @font-face in the token layer would have avoided the omission and cost more than it
 * saved: it hard-codes a path no bundler fingerprints, so a font change is served stale
 * out of every cache that already held it, and nothing is preloaded. next/font/local
 * self-hosts the bytes, fingerprints the filenames, emits the preload link and sets
 * `display: swap` — so the app owns the loading and the token layer owns only the names.
 * That is why this is duplicated per app rather than hoisted: it is the app's job.
 *
 * The bytes come from our own origin over the connection the document already opened, so
 * there is no DNS lookup and no second TLS handshake — which `font-src 'self'` in
 * src/proxy.ts forbids anyway. `display: swap` means text paints immediately in the
 * system stack and swaps when the face lands, so first contentful paint is unchanged.
 *
 * WHY A STYLE OBJECT RATHER THAN next/font's `variable` CLASS. A class on <html> and the
 * `:root` rule in typography.css have identical specificity, so which one won would come
 * down to the order Next happened to emit two CSS chunks in — a coin toss decided at
 * build time, surfacing later as the display face reverting to system-ui on one deploy and
 * not the next. An inline style has no such argument to lose.
 *
 * The fallbacks after each generated family are not decoration: the hashed family name
 * matches nothing until the file arrives, and a page that renders in Roboto is a correct,
 * entirely usable page — which is what a member of staff sees for the first few hundred
 * milliseconds.
 *
 * @see packages/ui/src/tokens/typography.css — the reasoning, in full
 * @see apps/patient-portal/src/app/fonts.ts — the same contract, same two properties
 */
const display = localFont({
  src: [
    { path: '../../../../packages/ui/src/fonts/texgyreadventor-regular.woff2', weight: '400', style: 'normal' },
    { path: '../../../../packages/ui/src/fonts/texgyreadventor-bold.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
})

const body = localFont({
  src: [
    { path: '../../../../packages/ui/src/fonts/poppins-400.woff2', weight: '400', style: 'normal' },
    { path: '../../../../packages/ui/src/fonts/poppins-500.woff2', weight: '500', style: 'normal' },
    { path: '../../../../packages/ui/src/fonts/poppins-600.woff2', weight: '600', style: 'normal' },
    { path: '../../../../packages/ui/src/fonts/poppins-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
})

/**
 * `--font` and `--head` on <html>. Those two properties are the whole contract —
 * everything else in the product reads `var(--font)` or `var(--head)` and never names a
 * family.
 */
export const fontStyle: Record<string, string> = {
  '--font': `${body.style.fontFamily}, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
  '--head': `${display.style.fontFamily}, ${body.style.fontFamily}, system-ui, sans-serif`,
}
