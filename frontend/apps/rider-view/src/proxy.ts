import { NextResponse, type NextRequest } from 'next/server'

/**
 * The Content Security Policy, and the per-request nonce it needs.
 *
 * WHY THIS IS NOT IN next.config.ts. It used to be, and it said `script-src 'self'` —
 * which reads as the strictest possible thing and is, in practice, a switch that turns
 * the product off. Next boots React with a small INLINE script; `'self'` does not cover
 * inline, so the browser refuses it, hydration never runs, and every client component on
 * the surface is inert while the page looks completely normal.
 *
 * That is not hypothetical. It shipped in the patient portal, survived review, and was
 * found only by clicking a control and measuring the DOM — a CSP failure is silent unless
 * somebody opens the console. This view has escaped it so far for one reason only: it has
 * no interactivity to lose yet. And it is the surface where that would hurt most: the
 * rider's whole job here is to change a status, on a phone, on a bad connection, with no
 * devtools and nobody to tell. A tap that does nothing reads as the network being slow.
 *
 * A nonce cannot come from next.config.ts, because a header declared there is identical on
 * every response and a nonce that repeats is not a nonce. It has to be minted per request,
 * which is what this file is for. Next then reads the policy off the REQUEST, finds the
 * `'nonce-…'`, and stamps it onto its own framework and bundle scripts automatically —
 * @see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
 *
 * Deliberately kept in step with apps/patient-portal/src/proxy.ts, which is where this
 * shape was proven. Four surfaces with four subtly different policies is four things to
 * hold in your head; the directives below differ from the portal's only where the surfaces
 * genuinely differ, and each of those differences says why.
 *
 * THIS FILE IS NECESSARY AND, TODAY, NOT SUFFICIENT — src/app/layout.tsx has to read the
 * nonce before any of it takes effect, and that is not a style point. Next injects the
 * nonce DURING the render, from the CSP header on the request. A route prerendered at build
 * time has no request, so it ships script tags with no `nonce` attribute; 'strict-dynamic'
 * then discards 'self' and the browser refuses ALL of them, framework chunks included.
 *
 * Measured on the clinic console, which is built identically to this one: `next build`
 * reports `/` as `○ (Static)`, and the HTML `next start` serves contains 8 <script> tags and
 * 0 `nonce=` attributes while the response header carries a nonce. The patient portal, same
 * policy, serves 9.
 *
 * The portal is not special — its root layout awaits `headers()` to read x-nonce, which
 * opts every route into dynamic rendering as a side effect. This layout reads nothing, so
 * it stays static. Until it does the same, this surface is no more hydrated than it was
 * under the old `script-src 'self'`; it is only differently unhydrated. The framework says
 * this outright: "When you use nonces in your CSP, all pages must be dynamically rendered."
 *
 * @see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
 * @see docs/30-architecture/frontend-nextjs.md
 */
export function proxy(request: NextRequest): NextResponse {
  // Unpredictable and single-use. `crypto.randomUUID()` is available on the edge runtime
  // and is a CSPRNG, which Math.random is not — a guessable nonce is a CSP that an
  // injected script can satisfy.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  // React uses eval in development to rebuild server stacks for the error overlay. It does
  // not in production, and this must never leak there: the whole value of the policy is
  // that an injected string cannot become code.
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
     * 'unsafe-inline' HERE AND ONLY HERE, and it is a decision rather than something
     * carried over unread. A nonce authorises a <style> ELEMENT; it can never authorise a
     * style ATTRIBUTE — that is `style-src-attr` with `'unsafe-hashes'`, a different
     * directive taking a different value. Next stamps the inline <style> it generates
     * itself with the nonce, so the framework alone would survive `style-src 'nonce-…'`;
     * the first component here that sets a `style` prop would not, and it would fail the
     * same silent way `script-src 'self'` did — a rule that quietly never applies, on a
     * page that looks right.
     *
     * The framework's own CSP example uses `style-src 'nonce-…'`. In the patient portal
     * copying it would strip every clinic's colours, which arrive as exactly such an
     * attribute and ARE the product. This view is Carevelo-branded and carries no
     * --brand-* tokens, so here the cost is smaller — a layout losing a rule rather than a
     * tenant losing its identity — but it is the same failure, and not worth diverging the
     * two policies over.
     *
     * Scripts get no such allowance, which is the part that matters even here, where the
     * rider payload is deliberately free of clinical content: the session cookie on this
     * device is still a way into somebody's assignments.
     */
    "style-src 'self' 'unsafe-inline'",

    // Unchanged from the static header this replaces. Nothing on this surface loads a
    // remote image; blob:/data: cover an image the client itself builds in memory.
    "img-src 'self' data: blob:",
    "font-src 'self'",

    /*
     * Reverb, over the same origin — unchanged from the static header this replaces.
     *
     * `ws:` and `wss:` are SCHEME sources: they match any host and any port, which is
     * looser than we would like and is why they are here rather than 'self'. 'self' means
     * same scheme, host AND port, and Reverb runs as its own supervised process rather
     * than inside the app server, so a websocket to it is a different origin by the port
     * alone. Worth narrowing to the concrete Reverb origin once it is fixed per
     * environment; until then this is the directive that lets a newly assigned delivery
     * appear on the rider's screen without a refresh.
     */
    "connect-src 'self' ws: wss:",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    // Nothing frames this. A rider's status control is exactly the kind of single tap a
    // clickjack would want, and there is no legitimate embedding case to weigh against it.
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

  /*
   * Forwarded on the REQUEST so the render can read it. This is the half that is easy to
   * leave out and impossible to notice: Next parses THIS copy to find the nonce, so
   * without it the framework's own scripts go out unstamped and strict-dynamic blocks
   * them. x-nonce is for us — a Server Component that renders a <script> of its own reads
   * it through `headers()`.
   */
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
   * immutable, cacheable assets that need no policy of their own, and running this on each
   * of them would mint a nonce per asset for nothing — which on the surface with the worst
   * connection in the product is not a rounding error.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
