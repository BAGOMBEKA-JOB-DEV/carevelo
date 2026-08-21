import { cookies, headers } from 'next/headers'
import { ApiClient, ApiError } from '@carevelo/api-client'

/**
 * How this domain reaches the API, and why it is not one line.
 *
 * ------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 *
 * `@carevelo/api-client` sets `credentials: 'include'`, which is exactly right in a
 * browser and does precisely nothing in a Node process. Every screen in this domain is
 * server-rendered, so the administrator's session cookie has to be lifted off the incoming
 * request and put on the outgoing one by hand. So does `Origin`: Sanctum only treats a
 * request as coming from its own frontend when the Origin or Referer host matches
 * `config/sanctum.php`'s stateful list, and only then does it authenticate from the
 * session at all. Without that header `auth:sanctum` falls through to bearer tokens this
 * architecture deliberately does not use, and every read returns 401.
 *
 * DELIBERATE DUPLICATION, NAMED AS SUCH. `apps/patient-portal/src/domains/scheduling/api/http.ts`
 * is the same shape and says the same thing. It cannot be shared: the two live in
 * different apps, `no-app-to-app` forbids the import, and packages/ui is domain-agnostic
 * by charter — a module that knows about Sanctum session forwarding is not a UI
 * primitive. This console has no `src/lib/api.ts` yet; the moment a SECOND domain here
 * needs this, that is the file it belongs in, and `.dependency-cruiser.cjs` already names
 * it as the one module allowed to hold it.
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
 * TENANCY, ON A CAREVELO-BRANDED SURFACE
 *
 * The console wears Carevelo's colours and is served from the CLINIC'S SUBDOMAIN, which
 * looks like a contradiction and is not. Branding is a design decision about who the
 * screen is addressed to; the host is how the API resolves the tenant, and it resolves it
 * from the host and from nothing else. An administrator at `kira.carevelo.app/settings`
 * is administering Kira because of the host in the address bar, not because of anything
 * this app sends. There is no tenant parameter anywhere below, and there must never be
 * one — a client-supplied tenant is the shape of a cross-tenant write.
 */

/**
 * The host this request was really made to.
 *
 * x-forwarded-host FIRST, and this is not belt-and-braces — it is the only header that
 * survives. On the render Next performs when a Server Action calls `redirect()`, the plain
 * `host` header degrades from `kira.localhost:3001` to `localhost:3001`: the clinic's
 * subdomain, which is the entire basis of tenancy, is gone. Every settings screen is
 * reached through an action that redirects, so this is not an edge case here — it is the
 * ordinary path, and getting it wrong turns "save" into "this clinic does not exist".
 * Measured in the patient portal on exactly this failure; see its `src/lib/tenant.ts`.
 */
export async function tenantHost(): Promise<string> {
  const requestHeaders = await headers()

  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost'
}

/**
 * The API origin for this request, with the CLINIC'S SUBDOMAIN PRESERVED.
 *
 * In production the console and the API share a host, so the address is already right.
 * Locally they differ by port, and the subdomain has to be carried across the swap or the
 * API resolves no tenant at all and answers 404 to a request the administrator made
 * correctly.
 */
export async function apiOrigin(host: string): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    return `https://${host}`
  }

  const url = new URL(configured)
  url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`

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
 * The headers that make a server-side call authenticate as the administrator sitting in
 * front of the browser.
 *
 * The scheme on `Origin` is not significant — Sanctum strips it and compares hosts and
 * ports — which is why `http://` here is correct against an https deployment.
 */
export async function sessionHeaders(host: string): Promise<Record<string, string>> {
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
 * A CSRF token for this session, and the cookies that go with it, on the API's origin.
 *
 * `/sanctum/csrf-cookie` sits OUTSIDE `/api` and returns no body — its whole job is to set
 * two cookies — so there is no response type to import and nothing for ApiClient to
 * translate. That is why this one call is made with the platform `fetch`: routing a
 * bodyless cookie-setter through a JSON client would be ceremony around two `Set-Cookie`
 * headers. `no-restricted-imports` and the `api-only-through-the-client` boundary rule
 * both name third-party HTTP clients; the platform fetch is neither.
 *
 * ONLY CALL THIS FROM A SERVER ACTION. It writes to the cookie jar, which throws during
 * render.
 */
async function csrfHeaders(host: string, origin: string): Promise<Record<string, string>> {
  const response = await fetch(new URL('/sanctum/csrf-cookie', origin), {
    headers: await sessionHeaders(host),
    // A session-bearing response must never be cached, by anything.
    cache: 'no-store',
  })

  await forward(response.headers.getSetCookie())

  const jar = await cookies()
  const token = jar.get('XSRF-TOKEN')?.value
  const withSession = await sessionHeaders(host)

  if (token) {
    withSession['X-XSRF-TOKEN'] = token
  }

  return withSession
}

/**
 * A client for writes, carrying a fresh CSRF token.
 *
 * ONLY CALL THIS FROM A SERVER ACTION.
 */
export async function writeClient(): Promise<ApiClient> {
  const host = await tenantHost()
  const origin = await apiOrigin(host)

  return new ApiClient({ baseUrl: origin, headers: await csrfHeaders(host, origin) })
}

/**
 * The one request in this domain that ApiClient cannot make: the logo upload.
 *
 * `POST /v1/tenant/logo` is `multipart/form-data`, and ApiClient JSON-stringifies every
 * body it is given and stamps `Content-Type: application/json` on it. Handing it a
 * `FormData` would serialise to `{}` and the API would answer 422 for a file the
 * administrator did select. Teaching ApiClient about multipart is the right long-term
 * fix and it belongs to whoever owns packages/api-client — see the report accompanying
 * this domain.
 *
 * So this is the platform `fetch`, deliberately and narrowly: one endpoint, one body
 * type, the session and CSRF headers assembled by exactly the same code the JSON writes
 * use, and the boundary (no axios, no node-fetch, no second copy of a request type — the
 * only field is a file) intact. `Content-Type` is left UNSET on purpose; the runtime must
 * write it itself so it carries the multipart boundary.
 *
 * Returns the parsed body and the status, because the caller has to translate a failure
 * into a sentence and only the status distinguishes "not signed in" from "not an
 * administrator" from "that file is not an image".
 */
export async function postMultipart(
  path: string,
  form: FormData,
): Promise<{ status: number; body: unknown }> {
  const host = await tenantHost()
  const origin = await apiOrigin(host)

  const headers = await csrfHeaders(host, origin)
  headers.Accept = 'application/json'
  headers['X-Requested-With'] = 'XMLHttpRequest'

  const response = await fetch(new URL(`/api${path}`, origin), {
    method: 'POST',
    headers,
    body: form,
    cache: 'no-store',
  })

  const body: unknown = await response.json().catch(() => undefined)

  return { status: response.status, body }
}

/**
 * The result of a read that is allowed to fail without taking the page down.
 *
 * A settings screen whose staff list failed should say so and keep the rest of itself —
 * the checklist, the other sections, the way back — on screen. Throwing would replace all
 * of it with the framework's error boundary, which tells an administrator nothing and
 * looks like the product is broken on the morning they are deciding whether to trust it.
 *
 * `status` is carried because this surface has to tell three failures apart and they need
 * three different screens: 401 is a session that ended, 403 is a colleague who is not an
 * administrator, and anything else is our problem. `humanise()` already writes a sentence
 * for each, but a sentence is not enough to decide what to RENDER.
 */
export type Attempt<T> =
  | { ok: true; value: T }
  | { ok: false; status: number | null; message: string | null }

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
      return { ok: false, status: error.status, message: error.message }
    }

    // Deliberately server-side only, and deliberately without the request's details: a
    // clinic's identifiers should not accumulate in a log because a socket closed.
    console.error('[tenant] a request to the API did not complete', error)

    return { ok: false, status: null, message: null }
  }
}

/**
 * The sentence a failed WRITE comes back with, and nothing more.
 *
 * Writes in this domain report through the URL rather than through an `Attempt`, because
 * a Server Action ends in a redirect and cannot hand a value back to the screen it came
 * from without making that screen a client component. See `components/screen.ts`.
 */
export async function attemptWrite(work: Promise<unknown>): Promise<string | null> {
  try {
    await work

    return null
  } catch (error) {
    if (error instanceof ApiError) {
      return error.message
    }

    console.error('[tenant] a write to the API did not complete', error)

    return null
  }
}
