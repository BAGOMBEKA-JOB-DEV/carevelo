import type { ReactNode } from 'react'
import { brandStyle } from '@carevelo/ui'
import '@carevelo/ui/tokens.css'
import { tryResolveTenant } from '@/lib/tenant'

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
  const tenant = await tryResolveTenant()

  return (
    <html lang="en" style={brandStyle(tenant?.branding)}>
      <body>{children}</body>
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
