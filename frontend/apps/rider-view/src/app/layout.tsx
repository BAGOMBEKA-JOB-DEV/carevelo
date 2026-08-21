import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import type { Metadata } from 'next'
import '@carevelo/ui/tokens.css'
/* AFTER the token layer, because it corrects two values in it. See rider.css: the whole
   file is four rules, each scoped to `.fieldview`, and three of them are stopgaps for
   things that belong in packages/ui — which this change does not own. The arithmetic
   behind each is written out there rather than asserted here. */
import './rider.css'

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
