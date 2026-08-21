import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import '@carevelo/ui/tokens.css'

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
