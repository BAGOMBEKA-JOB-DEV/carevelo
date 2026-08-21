import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { brandStyle } from '@carevelo/ui'
import '@carevelo/ui/tokens.css'
import { tryResolveTenant } from '@/lib/tenant'
import { fontStyle } from './fonts'

/**
 * The root layout, and the reason this app is server-rendered.
 *
 * The clinic's tokens go onto <html> HERE, during the server render, so they are in
 * the first HTML byte. That is acceptance criterion 7 — "branding is server-rendered
 * with no flash of unbranded content" — and it is why brandStyle returns a value
 * rather than applyBrand running in an effect: an effect runs after paint, and the
 * paint is the flash.
 *
 * A style OBJECT, so React sets these through the CSSOM. No tenant value is ever
 * concatenated into markup, which is a stronger guarantee than validation alone.
 *
 * The typeface variables ride on the same object, and merge rather than compete: both
 * are custom properties on the same element, set in one attribute. typography.css spells
 * out why they are an inline style and not next/font's `variable` class — briefly, a
 * class and that file's `:root` rule have identical specificity, so the winner would be
 * decided by CSS chunk order.
 *
 * lang is the clinic's, not the browser's. Consent text must render in English and
 * Luganda, and a screen reader needs to know which it is reading.
 *
 * The layout carries the TOKENS and nothing else. Site chrome belongs to the pages that
 * want it, because sign-in is a full-bleed split screen and a header above it would leave
 * the clinic's panel floating in the middle of the page.
 *
 * tryResolveTenant, NOT resolveTenant. A notFound() thrown from a root layout takes out
 * the very layout that not-found.tsx renders inside, so Next answers with its global error
 * shell — which streams no readable text, and produced a 404 that said nothing whatsoever
 * to anyone without JavaScript. The layout therefore tolerates an unknown host and paints
 * the default tokens; the PAGES call resolveTenant() and get a real, server-rendered 404.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [tenant, requestHeaders] = await Promise.all([tryResolveTenant(), headers()])

  /*
   * The per-request nonce minted in src/proxy.ts. Next stamps its own framework and
   * bundle scripts automatically, but the theme bootstrap below is ours, and the policy
   * uses 'strict-dynamic' — which discards `'self'`, so being served from our own origin
   * is no longer enough to make a script trusted. Without this attribute the bootstrap is
   * refused and a returning patient who chose dark gets a white flash on every load.
   */
  const nonce = requestHeaders.get('x-nonce') ?? undefined

  return (
    <html lang="en" style={{ ...brandStyle(tenant?.branding), ...fontStyle }}>
      <body>
        {/*
         * The theme, applied before the first paint. FIRST child of <body> and
         * deliberately render-blocking: the whole job is to set data-theme while the
         * parser is stopped, so a returning patient who chose dark never sees a white
         * page painted and then corrected. A flash on a screen showing someone's
         * prescription reads as a broken page rather than a slow one.
         *
         * NOT next/script. `beforeInteractive` is the strategy that sounds right and is
         * not: it loads during hydration — after the paint this exists to beat. A plain
         * external tag carrying the request's nonce runs while the parser is stopped and
         * needs no 'unsafe-inline'.
         *
         * The lint rule is right in general and wrong here: `async`/`defer` would move
         * this after the paint and reintroduce the flash it prevents. The file is 3KB,
         * served from the same origin, and cached.
         */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" nonce={nonce} />
        {children}
      </body>
    </html>
  )
}

/**
 * The tab title is the CLINIC's name. A patient switching tabs should see their
 * clinic, not ours.
 */
export async function generateMetadata() {
  const tenant = await tryResolveTenant()

  return {
    // An unknown host resolves to no clinic, and the title must not hint at what this
    // server is or whose clinics are on it.
    title: tenant?.trading_name ?? 'Not available',
    // Not indexable: a clinic's patient portal is not a public web page, and its
    // existence is the clinic's commercial information.
    robots: { index: false, follow: false },
  }
}
