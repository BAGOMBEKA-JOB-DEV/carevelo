import { NextResponse, type NextRequest } from 'next/server'

/**
 * The Content Security Policy, and the per-request nonce it needs.
 *
 * WHY THIS MOVED OUT OF next.config.ts. The policy used to be a static header, and it
 * said `script-src 'self'` — which reads as the strictest possible thing and was, in
 * practice, a switch that turned the product off. Next boots React with a small INLINE
 * script; `'self'` does not cover inline, so the browser refused it, hydration never
 * ran, and every client component on the surface was inert: the theme toggle did
 * nothing, the header never frosted on scroll, the mobile menu could not open. The
 * pages looked completely normal, which is why it survived — a CSP failure is silent
 * unless somebody opens the console or, as here, clicks the button and measures.
 *
 * A nonce cannot come from next.config.ts, because a header declared there is the same
 * for every response and a nonce that repeats is not a nonce. It has to be minted per
 * request, which is what this file is for. Next then reads the policy off the request,
 * finds the `'nonce-…'`, and stamps it onto its own framework and bundle scripts
 * automatically — @see docs at node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
 *
 * @see docs/30-architecture/frontend-nextjs.md
 */
export function proxy(request: NextRequest): NextResponse {
  // Unpredictable and single-use. `crypto.randomUUID()` is available on the edge
  // runtime and is a CSPRNG, which Math.random is not — a guessable nonce is a CSP
  // that an injected script can satisfy.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  // React uses eval in development to rebuild server stacks for the error overlay. It
  // does not in production, and this must never leak there: the whole value of the
  // policy is that an injected string cannot become code.
  const isDev = process.env.NODE_ENV === 'development'

  const csp = [
    "default-src 'self'",

    /*
     * 'strict-dynamic' is what makes this a real control rather than a host allow-list:
     * it discards 'self' and any host expression in favour of "only what a trusted
     * script loaded". Note the consequence — under strict-dynamic our OWN
     * /theme-init.js is no longer trusted merely for being same-origin, so the layout
     * has to hand it this nonce explicitly. 'self' stays for browsers that do not
     * implement strict-dynamic and would otherwise fall back to nothing.
     */
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,

    /*
     * 'unsafe-inline' HERE AND ONLY HERE, and it is deliberate rather than an oversight
     * carried over. The clinic's colours reach the page as an inline style ATTRIBUTE on
     * <html>, and a nonce cannot authorise an attribute — nonces apply to <style>
     * elements, `style-src-attr` is a separate thing, and the framework emits inline
     * style of its own besides. The exposure is far smaller than the keyword suggests:
     * a style attribute cannot open a new selector or rule the way a <style> block can,
     * every token is validated against /^#[0-9A-Fa-f]{6}$/ before React sets it, and the
     * API refuses to store a non-hex value at all. Scripts — the part that could
     * exfiltrate a patient's records — get no such allowance.
     *
     * The framework's own CSP example uses `style-src 'nonce-…'`. Copying it would have
     * silently stripped every clinic's branding, which is the product.
     */
    "style-src 'self' 'unsafe-inline'",

    // The clinic's logo is served from tenant-partitioned storage on our own origin.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The API shares the host, so the portal never talks to a third party.
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    // A clinic's portal has no business inside someone else's frame, and clickjacking a
    // "confirm payment" button is the obvious attack.
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

  // Forwarded on the REQUEST so the render can read it: Next parses this header to find
  // the nonce, and the root layout reads x-nonce to stamp the theme bootstrap.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  // And on the RESPONSE, because that is the copy the browser enforces.
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  /*
   * Everything except the framework's own static output and the favicon. Those are
   * immutable, cacheable assets that need no policy of their own, and running this on
   * each of them would mint a nonce per asset for nothing.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
