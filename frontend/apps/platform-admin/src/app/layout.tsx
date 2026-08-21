import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import '@carevelo/ui/tokens.css'

/**
 * Carevelo-branded, behind authentication. No tenant resolution and no --brand-*
 * tokens: this surface belongs to Carevelo, not to the clinic. Only the patient
 * portal is clinic-branded.
 *
 * THE SHELL IS NOT RENDERED HERE ANY MORE. A layout is never told which route is rendering
 * inside it, so a shell rendered here could not be given the active section — which is why
 * no nav item could ever be current, and why nobody noticed that all three links 404'd.
 * The pages render ControlPlaneShell and each names its own section. See that file for the
 * rest of the reasoning.
 *
 * The title template is here because it is the one part of the title that is the same on
 * every page. Pages export their own section name and Next composes the two.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export const metadata: Metadata = {
  title: {
    default: 'Platform admin',
    template: '%s · Platform admin',
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
