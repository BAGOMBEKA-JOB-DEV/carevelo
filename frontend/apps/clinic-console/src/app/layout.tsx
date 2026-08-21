import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import '@carevelo/ui/tokens.css'

/**
 * Carevelo-branded, behind authentication. No tenant resolution and no --brand-*
 * tokens: this surface belongs to Carevelo, not to the clinic. Only the patient
 * portal is clinic-branded.
 *
 * THE SHELL IS NOT RENDERED HERE ANY MORE, and that is the fix rather than a rearrangement.
 * A layout is never told which route is rendering inside it, so a shell rendered here could
 * not be given the active section — which is why every nav link in it was permanently
 * unhighlighted and, as it turned out, permanently broken. The pages render ConsoleShell
 * and each one names its own section, so the highlighting is a fact the page states rather
 * than one the frame has to guess. The patient portal already applies its frame from the
 * pages for its own reasons; see SiteShell there.
 *
 * It costs nothing to move: the nav is plain <a> elements, so every navigation is a
 * document load and there is no persistent layout being thrown away.
 *
 * The title template is here because it is the one part of the title that is the same on
 * every page. Pages export their own section name and Next composes the two.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export const metadata: Metadata = {
  title: {
    default: 'Clinic console',
    template: '%s · Clinic console',
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
