import { cookies } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { ApiClient, ApiError, humanise, type Problem } from '@carevelo/api-client'
import { requestHost } from '@/lib/tenant'

/**
 * Talking to the Carevelo API from the server, as the patient sitting in front of the
 * browser — the one piece of plumbing this domain owns.
 *
 * TWO WAYS OUT, AND THE SPLIT IS NOT ARBITRARY.
 *
 *   `apiClient()` returns the shared `ApiClient` and is what every READ goes through. It
 *   owns `credentials: 'include'`, the RFC 9457 translation and the query encoding, and
 *   the house rule is that a request goes through it — so a read that needs nothing more
 *   than the patient's cookie travelling outwards uses it and adds nothing.
 *
 *   `write()` is a raw `fetch`, and it exists because `ApiClient` cannot do the one thing
 *   an unsafe request on this surface requires: read `Set-Cookie` off the response. It
 *   returns a parsed body and nothing else, by design. A write here has to prime Laravel's
 *   CSRF cookie and re-issue whatever the API sets onto the portal's OWN response, or the
 *   patient's next request arrives with a session the API has already rotated away from.
 *   That is the same reason domains/identity/api/session.ts hand-rolls its transport, and
 *   this is deliberately the same shape rather than a second invention.
 *
 * WHY IT IS DUPLICATED RATHER THAN SHARED. The cookie-forwarding in identity is INTERNAL
 * to that domain — its index.ts exports four functions and none of them is a transport —
 * and reaching past a domain's public surface is a build failure, correctly. The honest
 * home for this is `src/lib/api.ts`, which .dependency-cruiser.cjs already names as the
 * sanctioned exception path for HTTP plumbing and which does not exist yet. Promoting it
 * there is a change to app-global code that more than one domain has to agree on; it is
 * written down in the handover note rather than done unilaterally from inside one domain.
 *
 * NO Idempotency-Key IS SENT, AND THAT IS CHECKED RATHER THAN ASSUMED. `PaymentIntentController`
 * is the only handler in the API that reads the header; nothing on the patient or consent
 * path does. Sending it anyway would be a header nobody consumes, which reads at a glance
 * like double-submit protection that is not there. Registration's real protection is the
 * server's silent de-duplication on phone number; see registerPatient().
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
 * that was never returned.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false
      readonly status: number
      /** The API's own sentence. Never paraphrased — see humanise(). */
      readonly message: string
      /**
       * The first field the API objected to, or null when the failure is not about one
       * field. Enough to put the error on the right control; deliberately not the whole
       * bag, because the bag travels in a URL and `humanise()` already picked the sentence
       * a person should read first.
       */
      readonly field: string | null
    }

/**
 * The API origin for this request, with the clinic's subdomain preserved.
 *
 * TENANCY IS THE HOST AND NOTHING ELSE. There is no tenant parameter here and there must
 * never be one — the API resolves the clinic from the Host header and ignores any client
 * attempt to assert it, so losing the subdomain does not degrade to "the wrong clinic", it
 * degrades to no clinic and a 404. Locally the portal and the API differ by port, which is
 * what NEXT_PUBLIC_API_ORIGIN carries; in production they share the host and nothing needs
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
 * See lib/tenant.ts: `host` degrades to the bare origin on the render Next performs after a
 * Server Action redirect, which is exactly the render every form in this domain produces.
 * `requestHost()` prefers `x-forwarded-host`, which survives it.
 */
async function currentHost(): Promise<string> {
  return (await requestHost()) ?? 'localhost'
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
 * The API client for a READ, carrying this patient's session and this patient's language.
 *
 * `Accept-Language` IS STILL SENT, THOUGH THE PORTAL NOW READS IN ONE LANGUAGE. Every
 * message this domain shows on a failure is the API's own sentence rather than one of ours
 * — a mistyped phone number comes back as prose from the server — so this header is the
 * only thing that decides what language the failure path speaks. Taking it from
 * `getLocale()` rather than hard-coding `'en'` means the day a second catalogue lands, the
 * API's validation messages follow the screen they land in without anybody having to
 * remember this file. It costs one already-resolved value per request.
 *
 * `Origin` is sent because Sanctum only treats a request as coming from its own frontend
 * when the Origin or Referer host is in the stateful list, and only a stateful request
 * consults the session cookie. Without it `auth:sanctum` falls through to bearer tokens
 * this architecture does not use and answers 401 to a perfectly good session. The SCHEME
 * is irrelevant — Sanctum compares host and port — so `http` here matches lib/session.ts
 * rather than inventing a second answer to the same question.
 */
export async function apiClient(): Promise<ApiClient> {
  const [host, cookie, locale] = await Promise.all([currentHost(), cookieHeader(), getLocale()])

  return new ApiClient({
    baseUrl: await apiOrigin(host),
    headers: {
      host,
      cookie,
      Origin: `http://${host}`,
      'Accept-Language': locale,
    },
  })
}

/**
 * Re-issue the API's cookies on the portal's own response.
 *
 * Without this the patient authenticates on the server and stays a guest in the browser:
 * the portal is a separate origin from the API, so a `Set-Cookie` received here never
 * reaches the handset. The portal and the API share the host and cookies ignore ports, so
 * re-setting them through Next's jar is enough for the browser to send the session back.
 *
 * The domain is left to the browser's default deliberately, which scopes each cookie to
 * this host alone. That is what keeps one clinic's session off another clinic's subdomain.
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
  const [host, cookie, locale] = await Promise.all([currentHost(), cookieHeader(), getLocale()])
  const origin = await apiOrigin(host)

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': locale,
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
    // Nothing on this path may be cached by anything: a registration, a consent decision
    // and a demographic correction are all per-person and none of them is idempotent.
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
 * PRIMED ON EVERY WRITE RATHER THAN ASSUMED PRESENT, because the first write this domain
 * makes is a REGISTRATION — by a visitor who has never signed in, holds no session and so
 * holds no XSRF-TOKEN. Reading the jar alone would work for the signed-in screens and fail
 * silently for the one screen a stranger reaches first.
 *
 * `/../sanctum/csrf-cookie` looks like a typo and is not: the route lives outside the /api
 * prefix this module prepends, and the URL parser removes the dot segment before the
 * request leaves. Spelled this way so there is one place the origin is assembled.
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
 * a native form post, and an exception there is a Next error page — which on this surface
 * means a patient mid-registration losing the form and being shown a stack shell instead of
 * "enter a valid Ugandan phone number, for example 0772 123 456".
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
 * requirement for a minor, the refusal to accept a stale policy version — and a guess that
 * disagrees with the server is worse than the server's own wording.
 *
 * A 404 IS LEFT AS THE API WROTE IT. A patient record belonging to another clinic answers
 * 404 rather than 403 on purpose, and nothing here may "helpfully" distinguish the two: the
 * fact that a person is a patient of a named clinic is special-category data under the DPPA.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 */
export function failure(status: number, body: unknown): Extract<Outcome<never>, { ok: false }> {
  const problem = (body ?? {}) as Problem
  const error = new ApiError(status, problem, humanise(status, problem))
  const field = Object.keys(problem.errors ?? {})[0] ?? null

  return { ok: false, status, message: error.message, field }
}
