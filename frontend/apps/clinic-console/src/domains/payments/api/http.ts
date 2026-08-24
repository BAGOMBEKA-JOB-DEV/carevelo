import { cookies, headers } from 'next/headers'
import { ApiClient, ApiError } from '@carevelo/api-client'

/**
 * How the payments domain reaches the Carevelo API, and why it is not one line.
 *
 * ------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 *
 * `@carevelo/api-client` sets `credentials: 'include'`, which is exactly right in a browser
 * and does precisely nothing in a Node process. Every screen in this domain renders on the
 * server, so the member of staff's session cookie has to be lifted off the incoming request
 * and put on the outgoing one by hand. So does `Origin`: Sanctum only treats a request as
 * coming from its own frontend when the Origin or Referer host is in the stateful list, and
 * only a stateful request consults the session cookie at all. Without it `auth:sanctum`
 * falls through to bearer tokens this architecture deliberately does not use, and a
 * perfectly good session is answered 401.
 *
 * ------------------------------------------------------------------
 * WHY READS AND WRITES ARE DIFFERENT CLIENTS
 *
 * A write needs Laravel's CSRF token, and obtaining one means calling
 * `/sanctum/csrf-cookie` and re-issuing what it sets onto THIS app's response. Writing to
 * the cookie jar is legal in a Server Action and THROWS during render, so a single client
 * that always primed a token would crash every page that only reads. Two functions is how
 * that stops being possible by accident: `readClient()` only ever reads the jar,
 * `writeClient()` is only ever called from an action.
 *
 * The one write in this domain is cash attestation. It resolves a payment to succeeded and
 * writes an audit event naming the person who pressed the button — so a silent 419 that
 * read to the front desk as "nothing happened" would be a patient turned away over money
 * they had already handed across the counter.
 *
 * ------------------------------------------------------------------
 * DELIBERATE DUPLICATION, NAMED RATHER THAN HIDDEN
 *
 * `src/domains/notifications/api/http.ts` and `src/domains/audit/api/http.ts` each carry a
 * read-only version of the same plumbing. The domain boundary forbids reaching into another
 * domain's internals — correctly, since a transport is not a public surface — and
 * `src/lib/` is app-global code that more than one change has to agree on. The honest home
 * is `src/lib/api.ts`, which `.dependency-cruiser.cjs` already names as the one module
 * allowed to hold HTTP plumbing and which does not exist in this app yet. Promoting it
 * there is written down in the handover rather than done unilaterally from inside one
 * domain. The patient portal made the same call for the same reason; see
 * apps/patient-portal/src/domains/scheduling/api/http.ts.
 *
 * The other two copies are READ-ONLY on purpose. Neither of those domains has a write —
 * the audit log cannot be written through any API, and there is no send endpoint for
 * notifications — so a `writeClient()` in either would describe a capability that does not
 * exist, which is the sort of thing somebody later mistakes for one that does.
 *
 * ------------------------------------------------------------------
 * NO TENANT PARAMETER, ANYWHERE
 *
 * Tenancy is resolved by the API from the host or the session and it ignores any client
 * attempt to assert it. There is no argument here to pass a clinic in, and there must never
 * be one: a client-supplied tenant is the shape of a cross-tenant read attempt.
 *
 * @see docs/30-architecture/multi-tenancy.md
 * @see docs/40-api/authentication-and-sessions.md
 */

/**
 * The API origin for this request, with the CLINIC'S SUBDOMAIN PRESERVED.
 *
 * Losing the subdomain does not degrade to "the wrong clinic" — it degrades to no clinic,
 * and the API answers 404 on a page a member of staff reached correctly. Locally the
 * console and the API differ by port, which is what NEXT_PUBLIC_API_ORIGIN carries; in
 * production they share a host and nothing needs rewriting.
 *
 * The port is stripped before the subdomain is read, because `kira.localhost:3001` split on
 * '.' would otherwise carry the port into the new host.
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
 * The host this request was really made to.
 *
 * `x-forwarded-host` FIRST, and that is not belt-and-braces. On the render Next performs
 * when a Server Action calls `redirect()` — which is exactly the render the cash
 * attestation form produces — the plain `host` header degrades to the bare origin and the
 * clinic's subdomain, the entire basis of tenancy, is gone. `x-forwarded-host` reports the
 * full host on both kinds of render.
 *
 * This does not weaken the rule that tenancy is never client-supplied. Both headers arrive
 * on the wire; whatever terminates TLS sets them, and the API remains the authority that
 * resolves the tenant and enforces row-level security. The console only asks.
 */
async function currentHost(): Promise<string> {
  const requestHeaders = await headers()

  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost'
}

/**
 * This app's own origin, which Sanctum compares against its stateful-domain list before it
 * will treat the cookie as a session at all.
 *
 * The scheme is read from `x-forwarded-proto` rather than hard-coded, because a mismatched
 * Origin does not fail loudly — it silently downgrades the request to a guest.
 */
async function consoleOrigin(host: string): Promise<string> {
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

/**
 * The headers that make a server-side call authenticate as the member of staff sitting in
 * front of the browser.
 *
 * `Accept-Language: en` IS SENT DELIBERATELY, AND THE VALUE IS NOT AN OVERSIGHT. Only the
 * patient portal is bilingual; the staff surfaces are English, and every failure message
 * this domain shows is the API's own sentence rather than one written here. Pinning the
 * header means a clinic whose browser advertises Luganda does not get a Luganda validation
 * message dropped into an otherwise-English console.
 */
async function sessionHeaders(host: string): Promise<Record<string, string>> {
  return {
    host,
    Origin: await consoleOrigin(host),
    Cookie: await cookieHeader(),
    'Accept-Language': 'en',
  }
}

/** A client for READING. Safe from a Server Component; never writes to the cookie jar. */
export async function readClient(): Promise<ApiClient> {
  const host = await currentHost()

  return new ApiClient({ baseUrl: await apiOrigin(host), headers: await sessionHeaders(host) })
}

/**
 * A client for WRITING, carrying the CSRF token the API requires on an unsafe verb.
 *
 * ONLY FROM A SERVER ACTION. It may have to mint the token, which means writing a cookie,
 * and Next allows that only in an Action or a Route Handler. Calling it during a render
 * throws — deliberately, since the alternative is an attestation POST that 419s silently
 * and reads to the front desk as a payment that simply refused to save.
 */
export async function writeClient(): Promise<ApiClient> {
  const host = await currentHost()
  const origin = await apiOrigin(host)
  const base = await sessionHeaders(host)
  const token = await csrfToken(origin, base)

  return new ApiClient({
    baseUrl: origin,
    headers: { ...base, ...(token ? { 'X-XSRF-TOKEN': token } : {}) },
  })
}

/**
 * The CSRF token this session holds, minting one if it has expired underneath the user.
 *
 * The raw `fetch` below is the one in this domain, and it is NOT an API data call: the
 * endpoint sits outside `/api` on the `web` middleware group, the response is 204 with no
 * body, there is no contract type to drift from, and what is needed is the response's
 * `Set-Cookie` headers — which `ApiClient` deliberately does not expose. Routing a bodyless
 * cookie-setter through a JSON client would be ceremony around two headers.
 */
async function csrfToken(origin: string, base: Record<string, string>): Promise<string | undefined> {
  const jar = await cookies()
  const held = jar.get('XSRF-TOKEN')?.value

  if (held) {
    return held
  }

  const response = await fetch(`${origin}/sanctum/csrf-cookie`, {
    headers: { ...base, Accept: 'application/json' },
    // A session-bearing response must never be cached, by anything.
    cache: 'no-store',
  })

  let minted: string | undefined

  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(';')[0] ?? ''
    const separator = pair.indexOf('=')

    if (separator < 0) {
      continue
    }

    const name = pair.slice(0, separator).trim()
    const value = decodeURIComponent(pair.slice(separator + 1).trim())

    // Re-issued on the console's own response so the browser holds what the API just
    // issued. Without this the next request mints another one and the session churns.
    // Domain is left to the browser's default, so the cookie belongs to this host alone —
    // which is what keeps one clinic's session off another clinic's subdomain.
    jar.set({ name, value, path: '/', sameSite: 'lax', httpOnly: name !== 'XSRF-TOKEN' })

    if (name === 'XSRF-TOKEN') {
      minted = value
    }
  }

  return minted
}

/**
 * The result of a read that is allowed to fail without taking the page down.
 *
 * A reconciliation screen whose export range was rejected should still show the day's
 * records; a payment record whose receipt call failed should still show that the payment
 * succeeded. Throwing replaces all of it with the framework's error boundary, which tells a
 * clinic nothing and looks like the software is broken.
 *
 * `status` is carried because ONE status has to be rendered differently rather than merely
 * reported: 403 on reconciliation, the notification log or the audit trail is not a fault,
 * it is the API saying this member of staff is not a clinic administrator. A screen that
 * showed "You do not have permission to do that." in a red box beside an empty table would
 * read as a broken page rather than as a boundary working correctly.
 */
export type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number | null; readonly message: string | null }

/**
 * Run a read, and turn a failure into something renderable.
 *
 * `message` is the API's OWN SENTENCE where there is one — `ApiError` has already put RFC
 * 9457 problem details through `humanise()` — and `null` where the request never reached
 * the API at all. A caller that gets `null` supplies its own wording, because there is
 * nothing to pass on and inventing detail about a failure nobody observed is how a support
 * call starts.
 */
export async function attempt<T>(work: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, status: error.status, message: error.message }
    }

    // Server-side only, and without the request's details: a payment reference or a
    // patient's identifiers should not accumulate in a log because a socket closed.
    console.error('[payments] a request to the API did not complete', error)

    return { ok: false, status: null, message: null }
  }
}

/** A response that is not JSON, and therefore not something `ApiClient` can carry. */
export type TextResponse =
  | {
      readonly ok: true
      readonly body: string
      /** The API's own `Content-Disposition`, so the filename is the backend's and not a guess. */
      readonly contentDisposition: string | null
    }
  | { readonly ok: false; readonly status: number | null; readonly message: string | null }

/**
 * A GET whose response body is text rather than JSON.
 *
 * THE ONE API DATA CALL IN THIS APP THAT DOES NOT GO THROUGH `ApiClient`, and it is not a
 * corner being cut. `ApiClient.send()` parses every response as JSON and returns the parsed
 * value; `GET /v1/reconciliation/export` answers `text/csv; charset=UTF-8`, so putting it
 * through the client returns `undefined` and the clinic downloads an empty file. There is
 * also no response type to drift from — the contract types the body as `string` — so the
 * usual reason for the rule, a hand-written copy of the contract, does not apply.
 *
 * The precedent is `/sanctum/csrf-cookie` above and in the patient portal: a raw `fetch` is
 * acceptable exactly where the shared client structurally cannot do the job, and it says so
 * in place. `.dependency-cruiser.cjs` enforces the rule against `axios`/`got`/`node-fetch`
 * and friends, none of which is in use here.
 *
 * THE BODY IS BUILT IN MEMORY RATHER THAN STREAMED, which mirrors the backend deliberately:
 * `ReconciliationExport` explains that a streamed response is written after the middleware
 * stack has unwound, when no tenant is bound, and row-level security would silently return
 * an empty file. The backend caps the range at 92 days, which is what keeps this bounded.
 *
 * A failure comes back as the API's own sentence where the body was problem+json — a range
 * that is too wide is a 422 with a message worth reading — and as a status alone otherwise.
 */
export async function getText(
  path: string,
  query: Record<string, string | undefined>,
): Promise<TextResponse> {
  const host = await currentHost()
  const origin = await apiOrigin(host)
  const url = new URL(`${origin}/api${path}`)

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, value)
    }
  }

  try {
    const response = await fetch(url, {
      headers: {
        ...(await sessionHeaders(host)),
        Accept: 'text/csv, application/problem+json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      // A tenant's commercial records must never sit in a shared cache.
      cache: 'no-store',
    })

    const body = await response.text()

    if (!response.ok) {
      return { ok: false, status: response.status, message: problemSentence(body) }
    }

    return {
      ok: true,
      body,
      contentDisposition: response.headers.get('content-disposition'),
    }
  } catch (error) {
    console.error('[payments] the reconciliation export did not complete', error)

    return { ok: false, status: null, message: null }
  }
}

/**
 * The readable sentence out of a problem+json body, or null.
 *
 * Written here rather than reached for from `humanise()` because there is no `ApiError` to
 * hand it — this path never had a parsed response. `title` is read as well as `detail`
 * because the backend's `ProblemDetails::make()` puts a validation message in `title` when
 * no detail is supplied, which is exactly the case for an export range that is too wide.
 */
function problemSentence(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)

    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }

    const problem = parsed as { detail?: unknown; title?: unknown; errors?: unknown }
    const errors = problem.errors

    if (typeof errors === 'object' && errors !== null) {
      const first = Object.values(errors as Record<string, unknown>)[0]

      if (Array.isArray(first) && typeof first[0] === 'string') {
        return first[0]
      }
    }

    if (typeof problem.detail === 'string') {
      return problem.detail
    }

    return typeof problem.title === 'string' ? problem.title : null
  } catch {
    // Not JSON at all — an HTML error page from something in front of the API. There is
    // nothing here worth showing a clinic administrator.
    return null
  }
}
