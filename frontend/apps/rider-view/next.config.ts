import type { NextConfig } from 'next'

/**
 * Strict CSP, no `unsafe-inline` for scripts. This surface renders clinical data.
 *
 * `frame-ancestors 'none'`: a console has no business inside another site's frame,
 * and clickjacking a "dispense" or "cancel" control is the obvious attack.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // Reverb, over the same origin.
  "connect-src 'self' ws: wss:",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ')

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
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
