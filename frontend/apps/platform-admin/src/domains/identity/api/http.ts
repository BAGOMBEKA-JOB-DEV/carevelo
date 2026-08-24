import { cookies, headers } from 'next/headers'
import { ApiClient, ApiError } from '@carevelo/api-client'

/**
 * How this app reaches the Carevelo API, and why the plumbing lives in the IDENTITY
 * domain rather than beside each caller.
 *
 * ------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 *
 * `@carevelo/api-client` sets `credentials: 'include'`, which is exactly right in a
 * browser and does precisely nothing in a Node process. Every screen on this surface is
 * server-rendered, so the operator's session cookie has to be lifted off the incoming
 * request and put on the outgoing one by hand. So does `Origin`: Sanctum only treats a
 * request as coming from its own frontend when the Origin or Referer host matches
 * `config/sanctum.php`'s stateful list, and only then does it authenticate from the
 * session at all. Without that header `auth:sanctum` falls through to bearer tokens this
 * architecture deliberately does not use, and every read returns 401.
 *
 * ------------------------------------------------------------
 * WHY IT IS IN identity/ AND EXPORTED FROM ITS index.ts
 *
 * The patient portal keeps a copy of this per domain and says so out loud: `src/lib/` is
 * the eventual home, `.dependency-cruiser.cjs` already names `src/lib/api.ts` as the one
 * file allowed to hold it, and until then a second copy is more honest than a boundary
 * quietly bent. This app would need THREE copies on day one — platform, break-glass and
 * identity itself — which is past the point where duplication is the honest option.
 *
 * So it sits where it actually belongs. A session-bearing client is not incidental
 * plumbing: it IS the operator's session, expressed as an HTTP header, and the session is
 * what the identity domain is for. `.dependency-cruiser.cjs` permits one domain to import
 * another's `index.ts` — "allowed, if awkward" — and the platform and break-glass domains
 * take it from there rather than each growing their own.
 *
 * If a fourth caller appears that has nothing to do with a session, that is the moment
 * this moves to `src/lib/api.ts`.
 *
 * ------------------------------------------------------------
 * WHY READS AND WRITES ARE DIFFERENT CLIENTS
 *
 * A write needs a CSRF token, and getting one means calling `/sanctum/csrf-cookie` and
 * re-issuing what it sets. `cookies().set()` is legal in a Server Action and in a Route
 * Handler, and THROWS during render — so a single client that always fetched a token
 * would crash every page that only reads. The two are separate functions so that cannot
 * happen by accident: `readClient()` only ever reads the jar, `writeClient()` is only
 * ever called from an action or a route handler.
 *
 * ------------------------------------------------------------
 * THERE IS NO TENANT SUBDOMAIN HERE, AND THAT IS THE POINT
 *
 * The patient portal carries the clinic's subdomain across when it swaps in the API
 * origin, because tenancy is resolved from the host. This surface is `admin.carevelo.app`
 * and resolves no tenant at all: every cross-tenant control endpoint names its tenant in
 * the path or — for break-glass alone — in the body. Nothing here rewrites the host, and
 * nothing here should start.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/30-architecture/multi-tenancy.md
 */

/** The host this request was really made to. */
async function requestHost(): Promise<string> {
  const header = await headers()

  return header.get('host') ?? 'localhost'
}

/**
 * The API origin for this request.
 *
 * In production the API and this app share a host, so the host IS the origin. In
 * development `NEXT_PUBLIC_API_ORIGIN` points at the Laravel server on another port.
 */
async function apiOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    return `https://${await requestHost()}`
  }

  return new URL(configured).origin
}

async function cookieHeader(): Promise<string> {
  const jar = await cookies()

  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

/**
 * The headers that make a server-side call authenticate as the operator sitting in front
 * of the browser.
 *
 * The scheme on `Origin` is not significant — Sanctum strips it and compares hosts and
 * ports — which is why `http://` here is correct against an https deployment.
 */
async function sessionHeaders(): Promise<Record<string, string>> {
  return {
    Origin: `http://${await requestHost()}`,
    Cookie: await cookieHeader(),
  }
}

/** A client for reads. Safe during render; never touches the cookie jar for writing. */
export async function readClient(): Promise<ApiClient> {
  return new ApiClient({
    baseUrl: await apiOrigin(),
    headers: await sessionHeaders(),
  })
}

/**
 * Re-issue the API's cookies on this app's own response.
 *
 * This app and the API are separate servers in development, so a `Set-Cookie` received
 * here is invisible to the browser unless it is put back. Only legal inside a Server
 * Action or a Route Handler.
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
    })
  }
}

/**
 * A client for writes, carrying a fresh CSRF token.
 *
 * `/sanctum/csrf-cookie` sits OUTSIDE `/api` and returns no body — its whole job is to set
 * two cookies — so there is no response type to import and nothing for ApiClient to
 * translate. That is the one call in this app made with the platform fetch, and this is
 * why: routing a bodyless cookie-setter through a JSON client would be ceremony around
 * two `Set-Cookie` headers.
 *
 * ONLY CALL THIS FROM A SERVER ACTION OR A ROUTE HANDLER. It writes to the cookie jar,
 * which throws during render.
 */
export async function writeClient(): Promise<ApiClient> {
  const origin = await apiOrigin()

  const response = await fetch(new URL('/sanctum/csrf-cookie', origin), {
    headers: await sessionHeaders(),
    // A session-bearing response must never be cached, by anything.
    cache: 'no-store',
  })

  await forward(response.headers.getSetCookie())

  const jar = await cookies()
  const token = jar.get('XSRF-TOKEN')?.value

  const headersToSend = await sessionHeaders()

  if (token) {
    headersToSend['X-XSRF-TOKEN'] = token
  }

  return new ApiClient({ baseUrl: origin, headers: headersToSend })
}

/**
 * The result of a read that is allowed to fail without taking the screen down.
 *
 * A control plane whose tenant list failed to load must still be able to request a
 * break-glass grant — that screen is used during an incident, and an incident is exactly
 * when a dependency is unwell. Throwing would replace the whole screen with the
 * framework's error boundary at the moment an operator needed one control on it.
 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string | null }

/**
 * Run a read, and turn a failure into something renderable.
 *
 * `message` is the API's OWN SENTENCE where there is one — `ApiError` has already put RFC
 * 9457 problem details through `humanise()` — and `null` where the request never reached
 * the API at all. A caller that gets `null` supplies its own sentence, because there is
 * nothing to pass on and inventing detail about a failure we did not observe is how an
 * operator ends up chasing the wrong thing during an incident.
 */
export async function attempt<T>(work: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message }
    }

    // Server-side only, and deliberately without the request's details. Nothing on this
    // surface is clinical, but a tenant identifier accumulating in a log because a socket
    // closed is still a record of which clinic somebody was looking at.
    console.error('[platform-admin] a request to the API did not complete', error)

    return { ok: false, message: null }
  }
}
