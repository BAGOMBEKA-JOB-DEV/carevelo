import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import type { Metadata } from 'next'
import '@carevelo/ui/tokens.css'
/* AFTER the token layer, because it corrects values in it. Every rule is scoped to
   `.fieldview`, and most of them are stopgaps for things that belong in packages/ui — which
   this change does not own. The arithmetic behind each is written out there rather than
   asserted here.

   IT HAS TO BE A ROOT-LAYOUT IMPORT RATHER THAN A PER-SCREEN ONE, which is easy to get
   wrong now that the file carries contrast corrections expressed as custom properties
   redefined per theme. A stylesheet imported by some routes and not others is present or
   absent depending on which page you landed on first, which would make a colour that passes
   WCAG AA on a cold load fail on a warm one. It also carries the white-on-primary button fix
   that dark mode makes mandatory, so anything rendering a button needs it — which is every
   route. */
import './rider.css'
import { fontStyle } from './fonts'

/**
 * Carevelo-branded, behind authentication. No tenant resolution and no --brand-*
 * tokens: this surface belongs to Carevelo, not to the clinic. Only the patient
 * portal is clinic-branded.
 *
 * THE SHELL IS NOT RENDERED HERE ANY MORE. A layout is never told which route is rendering
 * inside it, so a shell rendered here could not be given the active tab — which is why
 * neither tab could ever be marked current, and why nobody noticed that both of them
 * 404'd. The pages render FieldShell and each names its own tab. See FieldShell for the
 * rest of the reasoning; the patient portal applies its frame from the pages too.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export const metadata: Metadata = {
  title: {
    default: 'Deliveries',
    template: '%s · Deliveries',
  },
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
/*
 * headers() IS LOAD-BEARING HERE, AND IT LOOKS LIKE DEAD CODE.
 *
 * src/proxy.ts mints a per-request CSP nonce, and Next stamps it onto its own scripts during
 * the render — from the CSP header on the REQUEST. A statically prerendered route has no
 * request, so it gets no nonce; and because the policy carries 'strict-dynamic', which
 * discards 'self', the browser then refuses EVERY script including the framework chunks.
 * That is strictly worse than the static `script-src 'self'` this replaced, which at least
 * allowed the external ones.
 *
 * Measured, not assumed: with the route static, `next start` served this page with 8 script
 * tags and 0 nonce attributes while the response header carried a nonce. The patient portal,
 * on the same policy, served 9 nonce attributes — because its layout happens to await
 * headers() and that opts every route into dynamic rendering as a side effect.
 *
 * Next's own CSP guide states the rule: "When you use nonces in your CSP, all pages must be
 * dynamically rendered." There is no next.config.ts knob for it.
 *
 * The value is no longer merely proof of the point — the theme bootstrap below needs it —
 * but the rule above still holds independently of that script, so this call stays even if
 * the script ever goes. Delete it and the whole app silently stops running JavaScript.
 */
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    /*
     * suppressHydrationWarning on this element alone. theme-init.js sets data-theme while
     * the parser is stopped — before the first paint, which is the point of it — and React
     * would otherwise see an attribute the server never rendered and treat the root as a
     * mismatch, discarding and re-rendering the whole tree to resolve it. Nothing inside
     * <html> is exempted, so a genuine mismatch anywhere in the app still reports.
     */
    <html lang="en" suppressHydrationWarning style={fontStyle}>
      <body>
        {/*
         * The theme, applied before the first paint. FIRST child of <body> and deliberately
         * render-blocking: the whole job is to set data-theme while the parser is stopped,
         * so a rider who chose dark never sees a white page painted and then corrected. On
         * this surface that would happen on EVERY navigation, because the tab bar is plain
         * <a> elements and each tap is a full document load — and a full-screen white flash
         * on a phone held at arm's length at night is the worst version of this bug in the
         * product.
         *
         * NOT next/script. `beforeInteractive` loads during hydration — after the paint this
         * exists to beat. A plain external tag carrying the request's nonce runs while the
         * parser is stopped and needs no 'unsafe-inline'. The lint rule is right in general
         * and wrong here: async/defer would reintroduce the flash this prevents.
         *
         * The nonce is not optional decoration. proxy.ts uses 'strict-dynamic', which
         * discards 'self', so a same-origin script with no nonce is refused like any other.
         */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" nonce={nonce} />
        {children}
      </body>
    </html>
  )
}
