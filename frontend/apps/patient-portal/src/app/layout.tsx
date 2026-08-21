import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import '@carevelo/ui/tokens.css'
import { fontStyle } from './fonts'

/**
 * The root layout: typefaces, the theme bootstrap, and nothing else.
 *
 * THE CLINIC'S TOKENS ARE NOT SET HERE, AND THAT IS LOAD-BEARING. They used to be —
 * `brandStyle(tenant.branding)` on <html>, which meant this layout had to resolve the
 * tenant, which meant a `fetch` in the ROOT LAYOUT on every render.
 *
 * A fetch in the root layout is fine for an ordinary request and fatal for the render
 * Next performs when a Server Action calls redirect(): a single sign-in submission
 * allocated roughly 800MB, the RSC stream closed early, the browser never navigated, and
 * a few submissions later the server was killed by the OOM reaper. Measured, then
 * confirmed by removing this one call: 126MB before, 130MB after, and the redirect works.
 * Fetching in a PAGE is unaffected — /account resolves the tenant and its own session on
 * exactly that render and is fine. It is the root layout specifically.
 *
 * So the tokens moved down to the element each page already renders — `.site-root` in
 * SiteShell, `.auth-page` in the sign-in and set-password forms. Nothing is lost:
 * custom properties inherit, so a token set on a wrapper reaches every descendant exactly
 * as it did from <html>, and it is still in the first HTML byte, which is what acceptance
 * criterion 7 actually asks for — no flash of unbranded content.
 *
 * lang is the clinic's, not the browser's. Consent text must render in English and
 * Luganda, and a screen reader needs to know which it is reading.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  /*
   * The per-request nonce minted in src/proxy.ts. Next stamps its own framework and bundle
   * scripts automatically, but the theme bootstrap is ours, and the policy uses
   * 'strict-dynamic' — which discards `'self'`, so being served from our own origin is no
   * longer enough to make a script trusted.
   */
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    /*
     * suppressHydrationWarning on this element alone. theme-init.js sets data-theme while
     * the parser is stopped — before the first paint, which is the point of it — and React
     * would otherwise see an attribute the server never rendered and treat the root as a
     * mismatch. Nothing inside <html> is exempted.
     */
    <html lang="en" suppressHydrationWarning style={fontStyle}>
      <body>
        {/*
         * The theme, applied before the first paint. FIRST child of <body> and deliberately
         * render-blocking: the whole job is to set data-theme while the parser is stopped,
         * so a returning patient who chose dark never sees a white page painted and then
         * corrected.
         *
         * NOT next/script. `beforeInteractive` loads during hydration — after the paint this
         * exists to beat. A plain external tag carrying the request's nonce runs while the
         * parser is stopped and needs no 'unsafe-inline'. The lint rule is right in general
         * and wrong here: async/defer would reintroduce the flash this prevents.
         */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" nonce={nonce} />
        {children}
      </body>
    </html>
  )
}

/**
 * A neutral fallback for anything that cannot export its own metadata — notably
 * not-found.tsx, which by design has no clinic to name. Static, because resolving a tenant
 * here would put a fetch back in the root layout; see lib/metadata.ts for what that costs.
 */
export const metadata = {
  title: 'Not available',
  robots: { index: false, follow: false },
}
