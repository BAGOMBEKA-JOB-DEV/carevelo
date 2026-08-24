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
/**
 * The origins a patient may be sent to in order to finish paying.
 *
 * These are the hosted payment pages of the aggregators this platform integrates with —
 * sandbox and live — and they are written out rather than derived because CSP takes a list
 * of origins and nothing cleverer. They match the two the backend's own client will talk to
 * (`PesapalClient::SANDBOX_BASE_URL` and `LIVE_BASE_URL`), which is the only place the pair
 * is decided; if that ever moves, this moves with it. See `form-action` below for what
 * happens when the two disagree.
 */
const CHECKOUT_ORIGINS = ['https://pay.pesapal.com', 'https://cybqa.pesapal.com'] as const

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
     * 'strict-dynamic' WAS HERE AND HAD TO COME OUT. It was breaking the product, and it
     * did so in the exact silent way this file's own history warns about.
     *
     * What it does is discard 'self' and every host expression, leaving "only what an
     * already-trusted script loaded" plus anything carrying the nonce. That is a stronger
     * policy on paper. In an App Router app it is also incompatible with a PER-REQUEST
     * nonce, and the incompatibility only shows up once you drive the thing:
     *
     *   Next prefetches the routes a page links to. Each prefetch is its own request, so
     *   it is minted its own nonce, and the script tags in its RSC payload carry THAT
     *   nonce. When the router later inserts one of those tags into the page you are on,
     *   the document enforcing the policy is a DIFFERENT request with a DIFFERENT nonce.
     *   With 'strict-dynamic' there is no 'self' left to fall back on, so the browser
     *   refuses the script outright.
     *
     * Measured, not reasoned about: signed into the console and walked every screen with
     * a browser open. The chunk holding the Icon component was refused on /schedule,
     * /patients, /pharmacy, /dispatch and /schedule/book -- five of seven -- in the DEV
     * server and again in a real `next build && next start`, under a different chunk hash.
     * Removing this one token took all five to zero. Nothing else changed.
     *
     * WHAT IS ACTUALLY LOST. Without it, `'self'` authorises same-origin scripts again, so
     * an injected `<script src="/something-on-our-origin.js">` would run where
     * strict-dynamic would have refused it. That attack needs attacker-controlled
     * JavaScript served from this origin, and this surface serves none: the only
     * tenant-supplied asset is a logo, which the API validates, strips and re-encodes as
     * an image. The nonce still covers every inline script, which is the part that could
     * exfiltrate a patient's records.
     *
     * WHAT WOULD BE STRICTLY BETTER, and is a real piece of work rather than a token: a
     * nonce that is stable for the document and every prefetch it triggers. Next has no
     * hook for that today. A CSP that silently breaks the icons on five screens is not
     * more secure than one that does not -- it is a control nobody can afford to keep, and
     * it would have been switched off in a hurry by whoever found it next.
     */
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}`,

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
    /*
     * The API shares the host, so the portal never talks to a third party — and `ws:`/
     * `wss:` do not change that. They are here because the portal subscribes to Reverb for
     * payment and delivery state: a patient watching "awaiting your PIN" become "paid", or
     * a rider's status reach their order page, is watching a websocket, and without this
     * directive the connection is refused and the page just never updates. Silent in the
     * usual way — it looks exactly like a payment that has not confirmed yet.
     *
     * `ws:` and `wss:` are SCHEME sources: they match any host and any port, which is why
     * 'self' will not do the job. 'self' means same scheme, host AND port, and Reverb runs
     * as its own supervised process rather than inside the app server, so a websocket to it
     * is a different origin by the port alone. Looser than we would like, and worth
     * narrowing to the concrete Reverb origin once that is fixed per environment.
     */
    "connect-src 'self' ws: wss:",

    /*
     * `form-action` IS NOT 'self' ALONE, AND THE REASON IS THE ONE SCREEN THIS POLICY MUST
     * NOT BREAK.
     *
     * A clinic whose merchant account is with an aggregator that hosts its own payment page
     * gets a redirect journey: the patient presses Pay, the Server Action submits the order,
     * and the answer is a redirect to the aggregator's page. `PaymentMethodChooser` is a
     * NATIVE `<form action={serverAction}>` on purpose — it has to work before the bundle
     * arrives on a slow connection, which is the binding constraint on this product — so on
     * that path the redirect is an ordinary 303 answering an ordinary form POST.
     *
     * Chromium checks `form-action` against every hop of a form submission's redirect chain,
     * not merely against the form's own action attribute. With `'self'` alone the browser
     * therefore refuses the hop off this origin, silently as far as the patient is concerned:
     * they press Pay and the page does not move.
     *
     * MEASURED, NOT REASONED ABOUT. A POST to this origin answered with a 303 to
     * `https://cybqa.pesapal.com/...`, submitted from a real form in a real Chromium on
     * kira.localhost:3010, produced exactly this and nothing else:
     *
     *   Sending form data to 'http://kira.localhost:3010/…' violates the following Content
     *   Security Policy directive: "form-action 'self'". The request has been blocked.
     *
     * plus a `net::ERR_ABORTED` on the navigation. The page stayed where it was. Note that
     * the message names OUR url, not the aggregator's, which is what would make this so
     * expensive to diagnose from a bug report: it reads as though the portal refused its own
     * form.
     *
     * It is also invisible everywhere the bundle HAS arrived, because with JavaScript a
     * Server Action redirect is a client-side navigation rather than a form submission, and
     * navigations are not governed by this directive. So it would pass every review, pass
     * every click-through on a fast laptop, and fail for the patient on the mid-range Android
     * this product is built for — the same silent shape as the 'strict-dynamic' failure this
     * file already carries a scar from.
     *
     * WHAT IS ALLOWED IS AN ENUMERATION, NOT A WILDCARD. CSP has no way to say "wherever the
     * API sends them", and it should not: an origin listed here is an origin an injected form
     * on this page could post to. The backend independently refuses to hand out a redirect
     * that is not https on the aggregator's own host (`PesapalClient::isPesapalUrl`), and
     * `handoffFor` in the payments domain refuses anything that is not an absolute http(s)
     * URL, so this list is the third of three checks rather than the only one.
     *
     * ADD TO IT THE DAY ANOTHER HOSTED-CHECKOUT AGGREGATOR IS INTEGRATED. Forgetting is not a
     * build failure and not a test failure — it is a patient at that clinic who cannot pay,
     * and no error anywhere but their own browser console.
     */
    `form-action 'self' ${CHECKOUT_ORIGINS.join(' ')}`,
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
