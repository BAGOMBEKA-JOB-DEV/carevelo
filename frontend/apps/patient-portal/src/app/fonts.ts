import localFont from 'next/font/local'

/**
 * The two self-hosted faces, and the two custom properties the whole product reads.
 *
 * THE CONTRACT LIVES IN packages/ui/src/tokens/typography.css, and this file is its
 * other half. That layer names the families and nothing else, deliberately: a @font-face
 * declared there would hard-code a path no bundler fingerprints, so a font change would
 * be served stale out of every cache that already held it and nothing would be
 * preloaded. next/font/local self-hosts the bytes, fingerprints the filenames, emits the
 * preload link and sets `display: swap` — so the app owns the loading and the token layer
 * owns only the names.
 *
 * WHY THIS IS NOT ON THE CRITICAL PATH, given the budget in frontend-nextjs.md. The
 * bytes come from our own origin over the connection the document already opened, so
 * there is no DNS lookup and no second TLS handshake — which is exactly what the
 * reference design system's Google Fonts import would have cost, and what `font-src
 * 'self'` in next.config.ts forbids anyway. `display: swap` means the text paints
 * immediately in the system stack and swaps when the face lands: first contentful paint
 * is unchanged, and a patient on a throttled 3G connection reads the page in a system
 * font rather than waiting for ours.
 *
 * WHY A STYLE OBJECT RATHER THAN next/font's `variable` CLASS. A class on <html> and the
 * `:root` rule in typography.css have identical specificity, so which one won would come
 * down to the order Next happened to emit two CSS chunks in — a coin toss decided at
 * build time, surfacing later as the display face silently reverting to system-ui on one
 * deploy and not the next. An inline style has no such argument to lose. It is also how
 * the clinic's brand tokens already reach the same element, so the two merge into one
 * style attribute instead of fighting over a class.
 *
 * The fallbacks after each generated family are not decoration either: the hashed family
 * name matches nothing until the file arrives, and a page that renders in Roboto is a
 * correct, entirely usable page.
 *
 * @see packages/ui/src/tokens/typography.css — the reasoning, in full, and the source of
 *      this exact snippet
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
