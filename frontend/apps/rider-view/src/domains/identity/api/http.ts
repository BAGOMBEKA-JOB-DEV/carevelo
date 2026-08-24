import { cookies, headers } from 'next/headers'
import { unstable_rethrow } from 'next/navigation'
import { ApiClient, ApiError } from '@carevelo/api-client'

/**
 * How this app reaches the API as the signed-in rider, and why it is not one line.
 *
 * ------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 *
 * `@carevelo/api-client` sets `credentials: 'include'`, which is exactly right in a
 * browser and does precisely nothing in a Node process. Every screen in this app is
 * server-rendered, so the rider's session cookie has to be lifted off the incoming
 * request and put on the outgoing one by hand. So does `Origin`: Sanctum only treats a
 * request as coming from its own frontend when the Origin host matches
 * `config/sanctum.php`'s stateful list, and only then does it authenticate from the
 * session at all. Without that header `auth:sanctum` falls through to bearer tokens this
 * architecture deliberately does not use, and every read returns 401 — which on this
 * surface reads as "signed out on the road", the one failure a rider cannot recover from
 * while holding a package.
 *
 * ------------------------------------------------------------
 * WHY IT LIVES IN THE IDENTITY DOMAIN AND IS EXPORTED FROM IT
 *
 * The patient portal has three copies of this plumbing — `lib/tenant.ts`,
 * `domains/identity/api/session.ts` and `domains/payments/api/client.ts` — each of which
 * says, in its own comment, that it is a copy and that the fourth belongs in
 * `src/lib/api.ts`. This app has exactly two domains and would have made copies one and
 * two on its first day.
 *
 * So it is written once, here, and reached from the delivery domain through
 * `@/domains/identity` — the domain's PUBLIC surface, which `.dependency-cruiser.cjs`
 * permits and which reaching into `../identity/api/http` would not be. That placement is
 * a claim, not an accident: a client that carries a session is the session made usable,
 * and the session is what the identity domain is for. If a third consumer ever appears,
 * `src/lib/api.ts` is where this moves — the boundary rules already name that file as the
 * one allowed to hold it.
 *
 * ------------------------------------------------------------
 * WHY READS AND WRITES ARE DIFFERENT CLIENTS
 *
 * A write needs a CSRF token, and getting one means calling `/sanctum/csrf-cookie` and
 * re-issuing what it sets. `cookies().set()` is legal in a Server Action and THROWS
 * during render, so a single client that always fetched a token would crash every page
 * that reads. The two are separate functions so that cannot happen by accident:
 * `readClient()` only ever reads the jar, `writeClient()` is only ever called from an
 * action.
 *
 * ------------------------------------------------------------
 * THERE IS NO TENANT PARAMETER HERE, AND THERE MUST NEVER BE ONE
 *
 * This app resolves no clinic and paints no clinic's colours — it is Carevelo's own
 * surface, behind authentication (see src/app/layout.tsx). But the API still resolves
 * tenancy from the HOST and from nothing else, and every session is bound to exactly one
 * tenant with a mismatch answered by a hard 403 and an audit event. So the clinic's
 * subdomain has to survive the origin swap below, even though nothing on this surface
 * displays it. Losing it does not produce a subtle bug; it produces a rider who cannot
 * sign in.
 *
 * @see docs/30-architecture/multi-tenancy.md
 * @see docs/40-api/authentication-and-sessions.md
 */

/**
 * The host this request was really made to.
 *
 * x-forwarded-host FIRST, and this is not belt-and-braces — it is the only header that
 * survives. On the render Next performs when a Server Action calls `redirect()`, `host`
 * degrades from `kira.localhost:3002` to `localhost:3002`: the clinic's subdomain, which
 * is the entire basis of tenancy, is gone. This app's whole interaction model is a form
 * post followed by a redirect, so that render is not an edge case here — it is the normal
 * path after every status change. Measured in the patient portal, which hit it first: an
 * ordinary render reports the full host, the action-redirect render does not, and
 * x-forwarded-host reports it in both.
 */
async function requestHost(): Promise<string> {
  const requestHeaders = await headers()

  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost'
}

/**
 * The API origin for this request, with the CLINIC'S SUBDOMAIN PRESERVED.
 *
 * In production the apps and the API share a host, so the subdomain is already right and
 * nothing needs rewriting. Locally they differ by port: the port is stripped before the
 * subdomain is read, because `kira.localhost:3002` split on '.' would otherwise carry the
 * port into the new host and resolve no clinic at all.
 */
async function apiOrigin(host: string): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    return `https://${host}`
  }

  const url = new URL(configured)
  url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`

  return url.origin
}

/**
 * This app's own origin, which Sanctum compares against its stateful-domain list before
 * it will treat the cookie as a session at all.
 *
 * The scheme is read from `x-forwarded-proto` rather than hard-coded. Two of the patient
 * portal's three copies hard-code `http://`, which is right locally and wrong the moment
 * anything runs behind TLS — and a mismatched Origin does not fail loudly, it silently
 * downgrades the request to a guest.
 */
async function selfOrigin(host: string): Promise<string> {
  const requestHeaders = await headers()
  const forwarded = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const scheme = forwarded ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')

  return `${scheme}://${host}`
}

async function cookieHeader(): Promise<string> {
  const jar = await cookies()

  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

/** The headers that make a server-side call authenticate as the rider holding the phone. */
async function sessionHeaders(host: string): Promise<Record<string, string>> {
  return {
    host,
    Origin: await selfOrigin(host),
    Cookie: await cookieHeader(),
  }
}

/** A client for reads. Safe during render; never touches the cookie jar for writing. */
export async function readClient(): Promise<ApiClient> {
  const host = await requestHost()

  return new ApiClient({
    baseUrl: await apiOrigin(host),
    headers: await sessionHeaders(host),
  })
}

/**
 * A client for writes, carrying a fresh CSRF token.
 *
 * ONLY CALL THIS FROM A SERVER ACTION. It may write to the cookie jar, which throws
 * during render — deliberately, because the alternative is a status POST that silently
 * 419s and reads to the rider as a tap that did nothing.
 *
 * `statefulApi()` puts the whole `/api` group behind session cookies AND CSRF validation,
 * so a POST without `X-XSRF-TOKEN` is refused. A signed-in rider's browser already holds
 * `XSRF-TOKEN` because sign-in forwarded it; the mint below is for the case where it has
 * expired underneath them — which on a 12-hour session spent outdoors is not rare.
 */
export async function writeClient(): Promise<ApiClient> {
  const host = await requestHost()
  const origin = await apiOrigin(host)
  const token = await csrfToken(origin, host)
  const headersForCall = await sessionHeaders(host)

  if (token) {
    headersForCall['X-XSRF-TOKEN'] = token
  }

  return new ApiClient({ baseUrl: origin, headers: headersForCall })
}

/**
 * Re-issue the API's cookies on this app's own response.
 *
 * This app and the API are separate servers, so a `Set-Cookie` received here is invisible
 * to the browser unless it is put back. Only legal inside a Server Action.
 */
export async function forwardCookies(setCookies: readonly string[]): Promise<void> {
  const jar = await cookies()

  for (const raw of setCookies) {
    const [pair, ...attributes] = raw.split(';')
    const separator = pair?.indexOf('=') ?? -1

    if (!pair || separator < 0) {
      continue
    }

    jar.set({
      name: pair.slice(0, separator).trim(),
      value: decodeURIComponent(pair.slice(separator + 1).trim()),
      httpOnly: attributes.some((attribute) => attribute.trim().toLowerCase() === 'httponly'),
      sameSite: 'lax',
      path: '/',
      // Domain left to the browser's default, so the cookie belongs to this host alone.
      // That is what keeps one clinic's rider session off another clinic's subdomain.
    })
  }
}

/**
 * The CSRF token, minted if the browser is not already holding one.
 *
 * A raw fetch, and the only one in this app. `/sanctum/csrf-cookie` sits OUTSIDE `/api`
 * and returns 204 with no body — its whole job is to set two cookies — so there is no
 * response type to import, nothing for ApiClient to translate, and the one thing that IS
 * needed is `Set-Cookie`, which ApiClient deliberately does not expose.
 */
async function csrfToken(origin: string, host: string): Promise<string | undefined> {
  const jar = await cookies()
  const held = jar.get('XSRF-TOKEN')?.value

  if (held) {
    return held
  }

  const response = await fetch(new URL('/sanctum/csrf-cookie', origin), {
    headers: { Accept: 'application/json', ...(await sessionHeaders(host)) },
    // A session-bearing response must never be cached, by anything.
    cache: 'no-store',
  })

  await forwardCookies(response.headers.getSetCookie())

  return (await cookies()).get('XSRF-TOKEN')?.value
}

/**
 * The result of a read that is allowed to fail without taking the screen down.
 *
 * ON THIS SURFACE THAT IS NOT A NICETY. Next's error boundary renders a blank apology; a
 * rider who gets one at the roadside cannot tell it from the app being broken, and their
 * next move is a telephone call to the clinic — which is the cost this product exists to
 * remove. A failed read must leave the tab bar, the sign-out and whatever was already
 * fetched on the screen, and say what happened.
 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string | null }

/**
 * Run a read, and turn a failure into something renderable.
 *
 * `message` is the API's OWN SENTENCE where there is one — `ApiError` has already put RFC
 * 9457 problem details through `humanise()` — and `null` where the request never reached
 * the API at all. A caller that gets `null` writes its own sentence, because there is
 * nothing to pass on and inventing detail about a failure we did not observe is how a
 * support call starts.
 */
export async function attempt<T>(work: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    /*
     * CONTROL FLOW FIRST, ALWAYS. `headers()` and `cookies()` throw a `DynamicServerError`
     * while Next decides whether a route can be prerendered, and `redirect()` and
     * `notFound()` signal by throwing too. Swallowing one of those does not fail loudly —
     * it turns a redirect into a rendered page, or lets a route be prerendered, which on
     * this app would mean serving every rider the same cached HTML and, because the CSP
     * nonce is minted per request, HTML whose scripts the browser then refuses.
     * `unstable_rethrow` recognises those and re-throws; it is a no-op for anything else.
     */
    unstable_rethrow(error)

    if (error instanceof ApiError) {
      return { ok: false, message: error.message }
    }

    /*
     * Server-side only, and deliberately without the request's details. A rider payload
     * carries a patient's NAME, PHONE NUMBER AND HOME ADDRESS — no clinical content, but
     * personal data under the DPPA all the same — and none of it belongs in a log line
     * written because a socket closed.
     */
    console.error('[rider] a request to the API did not complete', error)

    return { ok: false, message: null }
  }
}
