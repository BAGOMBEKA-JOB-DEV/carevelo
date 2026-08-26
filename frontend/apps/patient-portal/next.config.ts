import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

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

/**
 * next-intl, wired in by filename rather than by import.
 *
 * The plugin's whole job is to alias `next-intl/config` to `./src/i18n/request.ts`, which
 * is how the library reaches our per-request configuration without anything importing it.
 * Called with no argument because that path is one of the two locations it looks in by
 * default; naming it explicitly would be a second place to update if the file ever moved.
 *
 * NOTE WHAT IS NOT CONFIGURED HERE: there is no locale routing, no middleware and no
 * `[locale]` URL segment. This app resolves its tenant from the HOST, and adding a second
 * routing dimension to every route would put the clinic's identity and the patient's
 * language in the same place — see src/i18n/locales.ts for the full argument. The language
 * lives in a cookie with an Accept-Language fallback instead.
 */
const withNextIntl = createNextIntlPlugin()

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
          /*
           * `camera=(self), microphone=(self)` — AND THIS LINE USED TO SAY `()`, WHICH
           * SILENTLY MADE VIDEO IMPOSSIBLE.
           *
           * The comment here previously read: "No browser feature on this surface needs a
           * camera or microphone at the document level; the consultation itself runs on the
           * video provider's origin." That was TRUE when it was written, when the plan was a
           * managed provider whose hosted page would sit in an iframe on ITS origin.
           *
           * ADR-0004 chose a self-hosted LiveKit and the SDK runs in THIS document, so
           * `getUserMedia` is called here. With an empty allowlist the browser refuses it
           * before any permission prompt appears, and the failure is one that no amount of
           * reading the application code would explain:
           *
           *     Permissions policy violation: microphone is not allowed in this document.
           *
           * The room connects, the participant joins, the SFU is happy, both tiles render —
           * and neither person can speak. It is exactly the shape of failure the media
           * degradation design exists to prevent, arriving from a header rather than a
           * network.
           *
           * `(self)` AND NOT `*`. The allowlist is this origin only, so the capability is
           * granted to the portal's own document and to nothing it ever embeds. The portal
           * frames no third party — `frame-ancestors 'none'` and `object-src 'none'` are in
           * the CSP above for the other direction — so `(self)` is the whole of what the
           * consultation needs and not one origin more.
           *
           * Geolocation is still never asked for, and payment is still refused: a patient
           * pays through a redirect to the aggregator's own page, not a browser API.
           */
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(), payment=()',
          },
          // A patient's own records must not sit in a shared cache.
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default withNextIntl(config)
