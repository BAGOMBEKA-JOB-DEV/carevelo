import type { NextConfig } from 'next'

/**
 * A strict Content Security Policy, with no `unsafe-inline` for scripts.
 *
 * Acceptance criterion 6, and it is a real control rather than a header to tick off.
 * This surface renders a patient's own health information and applies colours a
 * clinic chose; CSP is the layer that holds if validation somewhere ever does not.
 *
 * `style-src` DOES allow 'unsafe-inline', and that is worth being honest about
 * rather than quietly omitting. React writes the brand tokens as an inline style
 * attribute on <html>, and Next emits inline style for its own CSS handling. The
 * exposure is far smaller than it looks: an attribute cannot open a new rule or
 * selector the way a <style> block can, every token is validated against
 * /^#[0-9A-Fa-f]{6}$/ before it is set, and the API refuses to store a non-hex value
 * in the first place. Scripts — the part that could exfiltrate — get no such
 * allowance.
 *
 * `connect-src 'self'` because the API shares the host. `frame-ancestors 'none'`
 * because a clinic's portal has no business inside someone else's frame, and
 * clickjacking a "confirm payment" button is the obvious attack.
 *
 * @see docs/30-architecture/frontend-nextjs.md
 */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // The clinic's logo is served from tenant-partitioned storage on our own origin.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ')

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
          { key: 'Content-Security-Policy', value: csp },
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
