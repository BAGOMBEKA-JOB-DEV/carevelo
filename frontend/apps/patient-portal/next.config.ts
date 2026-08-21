import type { NextConfig } from 'next'

/**
 * Security headers that are the same for every response.
 *
 * THE CONTENT SECURITY POLICY IS NOT HERE — it lives in `src/proxy.ts`, because it
 * carries a per-request nonce and a header declared in this file is identical on every
 * response. A nonce that repeats is not a nonce.
 *
 * That move was not tidying. The policy used to say `script-src 'self'` from here, which
 * reads as maximally strict and in practice switched the product off: Next boots React
 * with an inline script, `'self'` does not cover inline, so hydration never ran and every
 * interactive control on the surface was dead while the pages looked perfectly normal.
 *
 * @see docs/30-architecture/frontend-nextjs.md
 */

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The budget is 150KB gzipped on the booking path. Source maps in production would
  // not ship to the client, but the build is quicker without them and nothing here
  // needs them.
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          // No browser feature on this surface needs a camera or microphone at the
          // document level; the consultation itself runs on the video provider's
          // origin. Geolocation is never asked for.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          // A patient's own records must not sit in a shared cache.
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default config
