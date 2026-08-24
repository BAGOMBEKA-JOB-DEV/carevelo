import { cookies } from 'next/headers'
import { ApiClient, ApiError } from '@carevelo/api-client'
import { requestHost } from '@/lib/tenant'

/**
 * How this domain reaches the API, and why it is not one line.
 *
 * ------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 *
 * `@carevelo/api-client` sets `credentials: 'include'`, which is exactly right in a
 * browser and does precisely nothing in a Node process. Every screen in this domain is
 * server-rendered, so the patient's session cookie has to be lifted off the incoming
 * request and put on the outgoing one by hand. So does `Origin`: Sanctum only treats a
 * request as coming from its own frontend when the Origin or Referer host matches
 * `config/sanctum.php`'s stateful list, and only then does it authenticate from the
 * session at all. Without that header `auth:sanctum` falls through to bearer tokens this
 * architecture deliberately does not use, and every read returns 401.
 *
 * DELIBERATE DUPLICATION, NAMED AS SUCH. `src/lib/tenant.ts` and
 * `src/domains/identity/api/session.ts` each do a version of this. The domain boundary
 * forbids reaching into identity's internals, and `src/lib/` is not this agent's to
 * extend, so the third copy is the honest option rather than a boundary quietly bent. If
 * a fourth appears, that is the moment it belongs in `src/lib/api.ts` — which
 * `.dependency-cruiser.cjs` already names as the one file allowed to hold it.
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
 */

/**
 * The API origin for this request, with the CLINIC'S SUBDOMAIN PRESERVED.
 *
 * Tenancy is resolved from the host and from nothing else, so swapping the origin without
 * carrying the subdomain across would resolve the wrong clinic — or none, which is a 404
 * on a page the patient reached correctly.
 */
async function apiOrigin(host: string): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    // Production: the portal and the API share the host, so it is already right.
    return `https://${host}`
  }

  const url = new URL(configured)
  url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`

  return url.origin
}

/**
 * The host this request was really made to.
 *
 * See `requestHost()`: on the render Next performs when a Server Action calls
 * `redirect()`, the plain `host` header loses the clinic's subdomain. Every call in this
 * domain goes through that helper for that reason.
 */
async function tenantHost(): Promise<string> {
  return (await requestHost()) ?? 'localhost'
}

async function cookieHeader(): Promise<string> {
  const jar = await cookies()

  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

/**
 * The headers that make a server-side call authenticate as the patient sitting in front
 * of the browser.
 *
 * The scheme on `Origin` is not significant — Sanctum strips it and compares hosts and
 * ports — which is why `http://` here is correct against an https deployment.
 */
async function sessionHeaders(host: string): Promise<Record<string, string>> {
  return {
    Origin: `http://${host}`,
    Cookie: await cookieHeader(),
  }
}

/** A client for reads. Safe during render; never touches the cookie jar for writing. */
export async function readClient(): Promise<ApiClient> {
  const host = await tenantHost()

  return new ApiClient({
    baseUrl: await apiOrigin(host),
    headers: await sessionHeaders(host),
  })
}

/**
 * Re-issue the API's cookies on the portal's own response.
 *
 * The portal and the API are separate servers, so a `Set-Cookie` received here is
 * invisible to the browser unless it is put back. Only legal inside a Server Action.
 */
async function forward(setCookies: readonly string[]): Promise<void> {
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
      // That is what keeps one clinic's session off another clinic's subdomain.
    })
  }
}

/**
 * A client for writes, carrying a fresh CSRF token.
 *
 * `/sanctum/csrf-cookie` sits OUTSIDE `/api` and returns no body — its whole job is to
 * set two cookies — so there is no response type to import and nothing for ApiClient to
 * translate. That is the one call in this domain made with the platform fetch, and it is
 * why: routing a bodyless cookie-setter through a JSON client would be ceremony around
 * two `Set-Cookie` headers.
 *
 * ONLY CALL THIS FROM A SERVER ACTION. It writes to the cookie jar, which throws during
 * render.
 */
export async function writeClient(): Promise<ApiClient> {
  const host = await tenantHost()
  const origin = await apiOrigin(host)

  const response = await fetch(new URL('/sanctum/csrf-cookie', origin), {
    headers: await sessionHeaders(host),
    // A session-bearing response must never be cached, by anything.
    cache: 'no-store',
  })

  await forward(response.headers.getSetCookie())

  const jar = await cookies()
  const token = jar.get('XSRF-TOKEN')?.value

  const headers = await sessionHeaders(host)

  if (token) {
    headers['X-XSRF-TOKEN'] = token
  }

  return new ApiClient({ baseUrl: origin, headers })
}

/**
 * The result of a read that is allowed to fail without taking the page down.
 *
 * A booking screen whose availability call failed should say so and keep the rest of
 * itself — the service, the price, the way back — on screen. Throwing would replace all
 * of that with the framework's error boundary, which tells a patient nothing and looks
 * like the clinic's software is broken.
 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string | null }

/**
 * Run a read, and turn a failure into something renderable.
 *
 * `message` is the API's OWN SENTENCE where there is one — `ApiError` has already put
 * RFC 9457 problem details through `humanise()` — and `null` where the request never
 * reached the API at all. A caller that gets `null` supplies its own sentence from the
 * message catalogue, because there is nothing to pass on and inventing detail about a
 * failure we did not observe is how a support call starts.
 */
export async function attempt<T>(work: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message }
    }

    // Deliberately server-side only, and deliberately without the request's details: a
    // patient's identifiers should not accumulate in a log because a socket closed.
    console.error('[scheduling] a request to the API did not complete', error)

    return { ok: false, message: null }
  }
}
