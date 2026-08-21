import type { ReactNode } from 'react'
import { headers } from 'next/headers'
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
 * So this call stays even though the value is only used to prove the point. Delete it and the
 * whole app silently stops running JavaScript.
 */
  await headers()

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
