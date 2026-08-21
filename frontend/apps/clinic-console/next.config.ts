import type { NextConfig } from 'next'

/**
 * Security headers that are genuinely the same on every response.
 *
 * THE CONTENT SECURITY POLICY IS NOT HERE — it lives in `src/proxy.ts`, because it carries
 * a per-request nonce and a header declared in this file is identical on every response. A
 * nonce that repeats is not a nonce, so the policy cannot be expressed here at all.
 *
 * That move was not tidying. The policy used to say `script-src 'self'` from this file,
 * which reads as maximally strict and in practice switches the product off: Next boots
 * React with an inline script, `'self'` does not cover inline, so hydration never runs and
 * every interactive control on the surface is dead while the pages look perfectly normal.
 * The patient portal shipped exactly that and it was found only by clicking a control and
 * measuring the DOM. This console had not been bitten yet only because it has no
 * interactivity to lose; the first `'use client'` component would have arrived dead.
 *
 * @see src/proxy.ts — the policy, and why each directive says what it says
 * @see docs/30-architecture/frontend-nextjs.md
 */

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), payment=()' },
          // Clinical data must not sit in a shared cache.
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default config
