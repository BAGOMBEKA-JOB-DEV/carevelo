import { cookies, headers } from 'next/headers'
import { ApiClient, ApiError, humanise, type Problem } from '@carevelo/api-client'

/**
 * Talking to the Carevelo API from the server, as the member of staff sitting in front of
 * the terminal — the one piece of plumbing this domain owns.
 *
 * ------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 *
 * `@carevelo/api-client` sets `credentials: 'include'`, which is exactly right in a browser
 * and does precisely nothing in a Node process. Every screen in this domain is
 * server-rendered, so the staff member's session cookie has to be lifted off the incoming
 * request and put on the outgoing one by hand. So does `Origin`: Sanctum only treats a
 * request as coming from its own frontend when the Origin or Referer host matches
 * `config/sanctum.php`'s stateful list, and only then does it authenticate from the session
 * at all. Without that header `auth:sanctum` falls through to bearer tokens this
 * architecture deliberately does not use, and every read returns 401.
 *
 * ------------------------------------------------------------
 * DELIBERATE DUPLICATION, NAMED AS SUCH
 *
 * The patient portal's `src/domains/patients/api/http.ts` and
 * `src/domains/scheduling/api/http.ts` each hold a version of this, and both say the same
 * thing about it: the domain boundary forbids reaching into another domain's internals, an
 * import between two APPS is a hard build failure, and `src/lib/api.ts` — which
 * `.dependency-cruiser.cjs` already names as the one sanctioned home for HTTP plumbing —
 * does not exist in this app. So this is the honest third copy rather than a boundary
 * quietly bent. The moment a second domain in THIS console needs it, it belongs in
 * `src/lib/api.ts`, and that is a change more than one domain has to agree on rather than
 * something to do unilaterally from inside this one.
 *
 * ------------------------------------------------------------
 * WHY READS AND WRITES ARE DIFFERENT FUNCTIONS
 *
 * `apiClient()` is the shared `ApiClient` and is what every READ goes through. It owns the
 * RFC 9457 translation and the query encoding, and the house rule is that a request goes
 * through it.
 *
 * `write()` is a raw `fetch`, and it exists because `ApiClient` cannot do the one thing an
 * unsafe request on this surface requires: read `Set-Cookie` off the response. A write here
 * has to prime Laravel's CSRF cookie and re-issue whatever the API sets onto the console's
 * OWN response, or the staff member's next request arrives carrying a session the API has
 * already rotated away from. It also writes to the cookie jar, which Next allows in a
 * Server Action and THROWS during render — which is exactly why the two are separate
 * functions rather than one client that always primes a token: a single entry point would
 * crash every page that only wanted to read.
 *
 * ------------------------------------------------------------
 * NO Idempotency-Key IS SENT, AND THAT IS CHECKED RATHER THAN ASSUMED
 *
 * `PaymentIntentController` is the only handler in the API that reads the header; nothing
 * on the patient, consent or account path does. Sending it anyway would be a header nobody
 * consumes, which reads at a glance like double-submit protection that is not there.
 * Registration's real protection is the server's silent de-duplication on phone number —
 * see `registerPatient()` — and there is deliberately none on account creation, which is
 * why a second submission there answers 409 rather than minting a second credential.
 *
 * @see docs/40-api/api-conventions.md
 * @see docs/40-api/authentication-and-sessions.md
 */

/**
 * The result of a write, shaped for a form that posts natively.
 *
 * A DISCRIMINATED UNION rather than `{ ok, data?, message? }`, because the caller of a
 * failed write must not be able to reach for `data` and get `undefined` past the compiler.
 * On this domain that would mean a consent decision "recorded" against a record identifier
 * that was never returned, or an account screen rendering `undefined` where the one and
 * only copy of a password should be.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false
      readonly status: number
      /** The API's own sentence. Never paraphrased — see `humanise()`. */
      readonly message: string
      /**
       * The first field the API objected to, or null when the failure is not about one
       * field. Enough to put the error on the right control; deliberately not the whole
       * bag, because the bag travels in a URL and `humanise()` has already picked the
       * sentence a person should read first.
       */
      readonly field: string | null
    }

/**
 * The API origin for this request, with the CLINIC'S SUBDOMAIN PRESERVED.
 *
 * TENANCY IS THE HOST AND NOTHING ELSE. There is no tenant parameter here and there must
 * never be one — the API resolves the clinic from the Host header and ignores any client
 * attempt to assert it, so losing the subdomain does not degrade to "the wrong clinic", it
 * degrades to no clinic and a 400. Locally the console and the API differ by port, which is
 * what `NEXT_PUBLIC_API_ORIGIN` carries; in production they share the host and nothing needs
 * rewriting.
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
 * `x-forwarded-host` FIRST, and this is not defensive padding. On the render Next performs
 * after a Server Action calls `redirect()` — which is the render every form in this domain
 * produces — the plain `host` header degrades to the bare origin and loses the clinic's
 * subdomain. Reading `host` alone works on the first paint and fails on the one after a
 * successful registration, which is the worst possible place to discover it.
 */
async function currentHost(): Promise<string> {
  const header = await headers()

  return header.get('x-forwarded-host') ?? header.get('host') ?? 'localhost'
}

/** Everything the browser is holding, as one header value. */
async function cookieHeader(): Promise<string> {
  const jar = await cookies()

  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

/**
 * `Accept-Language: en`, stated rather than omitted.
 *
 * The API validates in a language too, and every failure message this domain shows is the
 * API's own. The clinic console is an ENGLISH surface — only the patient portal is required
 * to be bilingual — so asking for English explicitly is what keeps a front-desk error
 * message in the language the rest of the screen is written in, regardless of what the
 * browser happens to advertise.
 *
 * Note what this does NOT govern: the consent policy text. That document is returned in
 * every language it exists in, and the desk shows the patient the rendering they can
 * actually read. See `ConsentDeskScreen`.
 */
const CONSOLE_LANGUAGE = 'en'

/**
 * The API client for a READ, carrying this staff member's session.
 *
 * The scheme on `Origin` is not significant — Sanctum strips it and compares host and port
 * — which is why `http://` here is correct against an https deployment.
 */
export async function apiClient(): Promise<ApiClient> {
  const [host, cookie] = await Promise.all([currentHost(), cookieHeader()])

  return new ApiClient({
    baseUrl: await apiOrigin(host),
    headers: {
      host,
      cookie,
      Origin: `http://${host}`,
      'Accept-Language': CONSOLE_LANGUAGE,
    },
  })
}

/**
 * Re-issue the API's cookies on the console's own response.
 *
 * The console and the API are separate servers, so a `Set-Cookie` received here is invisible
 * to the browser unless it is put back. Only legal inside a Server Action.
 *
 * The domain is left to the browser's default deliberately, which scopes each cookie to this
 * host alone. That is what keeps one clinic's session off another clinic's subdomain.
 */
async function forwardCookies(setCookies: readonly string[]): Promise<void> {
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
    })
  }
}

/** One request, with the browser's cookies going in and the API's coming back out. */
async function send(
  method: string,
  path: string,
  body: unknown,
  xsrf: string | undefined,
): Promise<{ status: number; body: unknown; cookies: string[] }> {
  const [host, cookie] = await Promise.all([currentHost(), cookieHeader()])
  const origin = await apiOrigin(host)

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': CONSOLE_LANGUAGE,
    'X-Requested-With': 'XMLHttpRequest',
    Origin: `http://${host}`,
    Cookie: cookie,
  }

  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json'
  }

  if (xsrf) {
    requestHeaders['X-XSRF-TOKEN'] = xsrf
  }

  const request: RequestInit = {
    method,
    headers: requestHeaders,
    // Nothing on this path may be cached by anything. A registration, a consent decision, a
    // merge and an issued credential are all per-person and none of them is idempotent.
    cache: 'no-store',
  }

  // Assigned rather than passed as undefined: exactOptionalPropertyTypes distinguishes
  // "absent" from "explicitly undefined", and fetch's own types accept only the former.
  if (body !== undefined) {
    request.body = JSON.stringify(body)
  }

  const response = await fetch(`${origin}/api${path}`, request)

  return {
    status: response.status,
    body: (await response.json().catch(() => undefined)) as unknown,
    cookies: response.headers.getSetCookie(),
  }
}

/**
 * The CSRF token, without which Laravel refuses every unsafe request.
 *
 * PRIMED ON EVERY WRITE RATHER THAN ASSUMED PRESENT. A front-desk terminal is left open all
 * day and Laravel rotates the session on sign-in and on password change, so the XSRF-TOKEN
 * in the jar is stale far more often here than on a surface somebody visits once. Reading
 * the jar alone would work in the morning and produce a 419 in the afternoon.
 *
 * `/../sanctum/csrf-cookie` looks like a typo and is not: the route lives outside the `/api`
 * prefix this module prepends, and the URL parser removes the dot segment before the request
 * leaves. Spelled this way so there is one place the origin is assembled.
 */
async function csrfToken(): Promise<string | undefined> {
  const response = await send('GET', '/../sanctum/csrf-cookie', undefined, undefined)

  await forwardCookies(response.cookies)

  const jar = await cookies()

  return jar.get('XSRF-TOKEN')?.value
}

/**
 * An unsafe request, with the CSRF dance and the cookie forwarding done for you.
 *
 * Returns an `Outcome` rather than throwing. Every caller of this is a Server Action behind
 * a native form post, and an exception there is Next's error page — which on this surface
 * means a member of staff with a patient across the counter losing the form they had filled
 * in and being shown a stack shell instead of "Enter a valid Ugandan phone number".
 */
export async function write<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
): Promise<Outcome<T>> {
  const xsrf = await csrfToken()
  const response = await send(method, path, body, xsrf)

  await forwardCookies(response.cookies)

  if (response.status >= 200 && response.status < 300) {
    return { ok: true, data: response.body as T }
  }

  return failure(response.status, response.body)
}

/**
 * The API's failure, turned into something a form can render.
 *
 * THE API'S OWN SENTENCE, UNCHANGED. `humanise()` prefers the first field error, then the
 * problem detail, and only invents copy for a bare status. Rewriting any of that here would
 * be this domain guessing at rules only the backend holds — the phone format, the guardian
 * requirement for a minor, the refusal of a stale policy version, "This registration was a
 * duplicate and its history moved to another record" — and a guess that disagrees with the
 * server is worse than the server's own wording.
 *
 * A 404 IS LEFT AS THE API WROTE IT. A patient record belonging to another clinic answers
 * 404 rather than 403 on purpose, and nothing here may "helpfully" distinguish the two: the
 * fact that a named person is a patient of a named clinic is special-category data under the
 * DPPA 2019.
 */
export function failure(status: number, body: unknown): Extract<Outcome<never>, { ok: false }> {
  const problem = (body ?? {}) as Problem
  const error = new ApiError(status, problem, humanise(status, problem))
  const field = Object.keys(problem.errors ?? {})[0] ?? null

  return { ok: false, status, message: error.message, field }
}

/**
 * The result of a read that is allowed to fail without taking the page down.
 *
 * A registry whose consent history call failed should still show the patient's name, their
 * status and the way back. Throwing would replace all of that with the framework's error
 * boundary, which tells a front-desk user nothing and looks like the clinic's software is
 * broken.
 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string | null }

/**
 * Run a read, and turn a failure into something renderable.
 *
 * `message` is the API's OWN SENTENCE where there is one, and `null` where the request never
 * reached the API at all. A caller that gets `null` supplies its own sentence, because there
 * is nothing to pass on and inventing detail about a failure we did not observe is how a
 * support call starts.
 */
export async function attempt<T>(work: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message }
    }

    /*
     * Server-side only, and deliberately without the request's details. A patient
     * identifier, a phone number or a name must not accumulate in a log because a socket
     * closed — the log is not a place clinical or identifying data is allowed to reach.
     */
    console.error('[patients] a request to the API did not complete', error)

    return { ok: false, message: null }
  }
}
