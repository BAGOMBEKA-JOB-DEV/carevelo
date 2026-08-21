import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { getLocale, getTranslations } from 'next-intl/server'
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
 * lang IS THE LANGUAGE THIS PAGE IS ACTUALLY IN, and until now that comment was a promise
 * rather than a fact: it said a screen reader needs to know which language it is reading
 * and then hard-coded `en`. It comes from src/i18n/locale.ts now — the same resolution
 * that picks the message catalogue, so the attribute and the text cannot disagree. A page
 * announcing English while rendering Luganda makes a screen reader apply English phonology
 * to Luganda words, which for somebody listening rather than reading is the difference
 * between a page and a noise.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  /*
   * The per-request nonce minted in src/proxy.ts. Next stamps its own framework and bundle
   * scripts automatically, but the theme bootstrap is ours, and the policy uses
   * 'strict-dynamic' — which discards `'self'`, so being served from our own origin is no
   * longer enough to make a script trusted.
   */
  const nonce = (await headers()).get('x-nonce') ?? undefined

  /*
   * Reading a cookie and a header, not the network. The rule this layout exists to protect
   * is "no fetch in the root layout" — see lib/metadata.ts for the 800MB it cost — and
   * resolving a language touches neither the API nor disk.
   */
  const locale = await getLocale()

  return (
    /*
     * suppressHydrationWarning on this element alone. theme-init.js sets data-theme while
     * the parser is stopped — before the first paint, which is the point of it — and React
     * would otherwise see an attribute the server never rendered and treat the root as a
     * mismatch. Nothing inside <html> is exempted.
     */
    <html lang={locale} suppressHydrationWarning style={fontStyle}>
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
 * not-found.tsx, which by design has no clinic to name.
 *
 * A FUNCTION RATHER THAN A CONSTANT ONLY SO THE TITLE CAN BE TRANSLATED, and the
 * distinction the layout's own comment draws still holds: the thing that must never happen
 * here is a FETCH. Resolving a tenant would be one. Reading the language off the request is
 * not — it is the cookie and header this render has already parsed — so the title follows
 * the page it titles instead of being English above a Luganda 404.
 *
 * Still says nothing about clinics. An unknown host must not learn whether a given clinic
 * is a customer, in either language.
 */
export async function generateMetadata() {
  const t = await getTranslations('Metadata')

  return {
    title: t('unavailable'),
    robots: { index: false, follow: false },
  }
}
