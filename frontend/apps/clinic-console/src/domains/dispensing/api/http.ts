import { cookies, headers } from 'next/headers'
import { ApiClient, ApiError } from '@carevelo/api-client'

/**
 * How the dispensing domain reaches the API, and why it is not one line.
 *
 * ------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 *
 * `@carevelo/api-client` sets `credentials: 'include'`, which is exactly right in a
 * browser and does precisely nothing in a Node process. Every screen in this domain is
 * server-rendered, so the pharmacist's session cookie has to be lifted off the incoming
 * request and put onto the outgoing one by hand. So does `Origin`: Sanctum only treats a
 * request as coming from its own frontend when the Origin or Referer host matches
 * `config/sanctum.php`'s stateful list, and only then does it authenticate from the
 * session at all. Without that header `auth:sanctum` falls through to the bearer tokens
 * this architecture deliberately does not use, and every read returns 401 — which on a
 * pharmacy queue looks exactly like "no work waiting".
 *
 * DELIBERATE DUPLICATION, NAMED AS SUCH. `apps/patient-portal/src/domains/scheduling/api/http.ts`
 * says the same thing for the portal, and `src/domains/delivery/api/http.ts` in this app
 * says it again for the dispatch board. This console has no `src/lib/` at all yet, and
 * `.dependency-cruiser.cjs` names exactly one file that may eventually hold this —
 * `src/lib/api.ts`. That file is not this change's to create, and reaching into another
 * domain's internals is a build failure rather than a code-review note, so the second copy
 * is the honest option rather than a boundary quietly bent. When a third consumer appears
 * in this app, that is the moment it moves to `src/lib/api.ts` and both copies delete.
 *
 * ------------------------------------------------------------
 * WHY READS AND WRITES ARE DIFFERENT CLIENTS
 *
 * A write needs a CSRF token, and getting one means calling `/sanctum/csrf-cookie` and
 * re-issuing what it sets. `cookies().set()` is legal in a Server Action and THROWS during
 * render, so a single client that always fetched a token would crash every screen that
 * merely reads. The two are separate functions so that cannot happen by accident:
 * `readClient()` only ever reads the jar, `writeClient()` is only ever called from an
 * action.
 *
 * ------------------------------------------------------------
 * NO TENANT ANYWHERE
 *
 * There is no `tenantId` parameter here and there must never be one. The API resolves the
 * clinic from the Host header and ignores any client attempt to assert it, and a
 * client-supplied tenant is not redundant so much as the shape of a cross-tenant read
 * attempt. What this file carries is the host the browser was already on.
 *
 * @see docs/30-architecture/multi-tenancy.md
 */

/**
 * The host this request was really made to.
 *
 * The console is served on the clinic's own host, and tenancy is resolved from it, so an
 * origin that lost the subdomain resolves the wrong clinic or none at all. `x-forwarded-host`
 * comes first because a proxy in front of the app rewrites `host` to its own upstream name
 * and puts the browser's value there.
 */
async function tenantHost(): Promise<string> {
  const inbound = await headers()

  return inbound.get('x-forwarded-host') ?? inbound.get('host') ?? 'localhost'
}

/**
 * The API origin for this request, with the CLINIC'S SUBDOMAIN PRESERVED.
 *
 * In production the console and the API share a host, so the host we were called on is
 * already the right one. In development they are on different ports, and
 * `NEXT_PUBLIC_API_ORIGIN` names the API — but naming it is not enough, because the
 * subdomain is the tenant. So the first label of the incoming host is grafted onto the
 * configured origin rather than the configured origin being used as-is.
 */
function apiOrigin(host: string): string {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    return `https://${host}`
  }

  const url = new URL(configured)
  const subdomain = host.split(':')[0]?.split('.')[0]

  if (subdomain) {
    url.host = `${subdomain}.${url.host}`
  }

  return url.origin
}

async function cookieHeader(): Promise<string> {
  const jar = await cookies()

  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

/**
 * The headers that make a server-side call authenticate as the member of staff sitting in
 * front of the browser.
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
    baseUrl: apiOrigin(host),
    headers: await sessionHeaders(host),
  })
}

/**
 * Re-issue the API's cookies on the console's own response.
 *
 * The console and the API are separate servers, so a `Set-Cookie` received here is
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
 * `/sanctum/csrf-cookie` sits OUTSIDE `/api` and returns no body — its whole job is to set
 * two cookies — so there is no response type to import and nothing for ApiClient to
 * translate. That is the one call in this domain made with the platform fetch, and this is
 * why: routing a bodyless cookie-setter through a JSON client would be ceremony around two
 * `Set-Cookie` headers.
 *
 * ONLY CALL THIS FROM A SERVER ACTION. It writes to the cookie jar, which throws during
 * render.
 */
export async function writeClient(): Promise<ApiClient> {
  const host = await tenantHost()
  const origin = apiOrigin(host)

  const response = await fetch(new URL('/sanctum/csrf-cookie', origin), {
    headers: await sessionHeaders(host),
    // A session-bearing response must never be cached, by anything.
    cache: 'no-store',
  })

  await forward(response.headers.getSetCookie())

  const jar = await cookies()
  const token = jar.get('XSRF-TOKEN')?.value
  const withToken = await sessionHeaders(host)

  if (token) {
    withToken['X-XSRF-TOKEN'] = token
  }

  return new ApiClient({ baseUrl: origin, headers: withToken })
}

/**
 * The result of a read that is allowed to fail without taking the screen down.
 *
 * THIS MATTERS MORE HERE THAN ANYWHERE ELSE IN THE PRODUCT. "Reverb being unavailable
 * degrades to polling and never blocks a clinical or dispensing action" is an acceptance
 * criterion, and the same reasoning applies one level up: a queue whose substitution list
 * failed to load should say so and still show the queue. Throwing would replace the whole
 * bench with the framework's error boundary, and a pharmacist with a patient at the
 * counter would have no way to work at all.
 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string | null }

/**
 * Run a read, and turn a failure into something renderable.
 *
 * `message` is the API's OWN SENTENCE where there is one — `ApiError` has already put RFC
 * 9457 problem details through `humanise()` — and `null` where the request never reached
 * the API at all. A caller that gets `null` supplies its own sentence, because there is
 * nothing to pass on and inventing detail about a failure we did not observe is how a
 * support call starts.
 */
export async function attempt<T>(work: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message }
    }

    // Server-side only, and deliberately without the request's details: this domain's URLs
    // carry order identifiers, and an order identifier resolves to a list of medicines.
    // Nothing clinical goes into a log, and neither does the key to something clinical.
    console.error('[dispensing] a request to the API did not complete', error)

    return { ok: false, message: null }
  }
}

/** The API's sentence for a failed write, or null when the request never arrived. */
export function sentence(error: unknown): string | null {
  return error instanceof ApiError ? error.message : null
}

/** The HTTP status of a failed write, or null when the request never arrived. */
export function statusOf(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null
}
