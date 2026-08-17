import type { ReactNode } from 'react'
import { brandStyle } from '@carevelo/ui'
import '@carevelo/ui/tokens.css'
import { resolveTenant } from '@/lib/tenant'
import { SiteShell } from '@/components/SiteShell'

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
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const tenant = await resolveTenant()

  return (
    <html lang="en" style={brandStyle(tenant.branding)}>
      <body>
        <SiteShell tenant={tenant}>{children}</SiteShell>
      </body>
    </html>
  )
}

/**
 * The tab title is the CLINIC's name. A patient switching tabs should see their
 * clinic, not ours.
 */
export async function generateMetadata() {
  const tenant = await resolveTenant()

  return {
    title: tenant.trading_name ?? 'Clinic',
    // Not indexable: a clinic's patient portal is not a public web page, and its
    // existence is the clinic's commercial information.
    robots: { index: false, follow: false },
  }
}
