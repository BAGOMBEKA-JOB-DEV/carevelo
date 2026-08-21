import { headers, cookies } from 'next/headers'
import { ApiClient, ApiError, type components } from '@carevelo/api-client'

/**
 * How this domain reaches the API as the member of staff sitting in front of the browser,
 * and who that person is.
 *
 * ------------------------------------------------------------------------------------
 * WHY A GATEWAY PER DOMAIN, WHEN THERE IS A PERFECTLY GOOD @carevelo/api-client
 *
 * `ApiClient` sets `credentials: 'include'`, which is exactly right in a browser and does
 * precisely nothing in a Node process. Every screen in this console is server-rendered, so
 * three things have to be lifted off the incoming request and put on the outgoing one by
 * hand before the API will treat the call as this member of staff's:
 *
 *   Host    tenancy is resolved from it and from nothing else. Lose the clinic's
 *           subdomain and you resolve the wrong clinic, or none.
 *   Cookie  the Sanctum session, forwarded from the browser's request.
 *   Origin  without it Sanctum does not consider the request to come from its own
 *           frontend, ignores the session entirely, and `auth:sanctum` answers 401 —
 *           which presents to a clinician as "I have been signed out" and to us as a
 *           bug report about a screen that was working a minute ago.
 *
 * The patient portal reached the same conclusion four separate times and wrote it down
 * each time (`src/lib/tenant.ts`, `src/lib/session.ts`, `domains/scheduling/api/http.ts`,
 * `domains/consultations/api/gateway.ts`). This console has no `src/lib` at all yet, and
 * `.dependency-cruiser.cjs` already names `src/lib/api.ts` as the one file allowed to hold
 * a raw fetch — so that is where this belongs in the end.
 *
 * IT IS NOT THERE TODAY, DELIBERATELY AND NAMED AS SUCH. `src/lib/` is app-global and is
 * being written concurrently by the changes that build the other console surfaces; a file
 * three changes each believe they own is a merge conflict in the one place every screen
 * depends on. Duplicated inside the domain is honest and reversible. Two sibling copies
 * of this file exist — `domains/consultations/api/gateway.ts` and
 * `domains/prescriptions/api/gateway.ts` — and both say the same thing at the top.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/30-architecture/multi-tenancy.md — the tenant is never a client-supplied value
 */

/**
 * The host this request was really made to.
 *
 * `x-forwarded-host` FIRST, and it is not belt-and-braces. On the render Next performs
 * after a Server Action calls `redirect()`, the plain `host` header degrades from
 * `kira.localhost:3001` to `localhost:3001` — the clinic's subdomain, which is the whole
 * basis of tenancy, is simply gone. Every screen in this domain is reached by exactly that
 * render after a booking. Measured in the patient portal rather than assumed; the same
 * proxy chain serves this app.
 */
async function currentHost(): Promise<string> {
  const requestHeaders = await headers()

  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost'
}

/**
 * The API origin for the clinic this request was made to, with the SUBDOMAIN PRESERVED.
 *
 * In production the console and the API share a host, so the origin is already right. In
 * development `NEXT_PUBLIC_API_ORIGIN` points at the API's own port and only the origin is
 * swapped — the clinic's first label is carried across, because dropping it resolves a
 * different clinic or no clinic, and "no clinic" is a 404 on a page staff reached
 * correctly.
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

async function sessionCookies(): Promise<string> {
  const jar = await cookies()

  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

async function sessionHeaders(host: string): Promise<Record<string, string>> {
  return {
    host,
    // The scheme is not significant: Sanctum strips it and compares hosts and ports, which
    // is why the `http://` literal is correct against an https deployment rather than a
    // bug waiting for production.
    Origin: `http://${host}`,
    Cookie: await sessionCookies(),
  }
}

/** A client for reads. Safe during render; never writes to the cookie jar. */
export async function readingApi(): Promise<ApiClient> {
  const host = await currentHost()

  return new ApiClient({
    baseUrl: await apiOrigin(host),
    headers: await sessionHeaders(host),
  })
}

/**
 * A client for writes, carrying the session AND the CSRF token.
 *
 * `statefulApi()` is on in the backend, so an unsafe request authenticated by a session
 * cookie must also carry `X-XSRF-TOKEN` or Laravel answers 419 — which is not a sentence
 * anybody can act on. The token is normally already in the jar from signing in; when it is
 * not, it is fetched.
 *
 * READS AND WRITES ARE SEPARATE FUNCTIONS ON PURPOSE, so a POST cannot be written against
 * a client that will have it rejected by an error nobody can explain.
 */
export async function writingApi(): Promise<ApiClient> {
  const host = await currentHost()
  const origin = await apiOrigin(host)
  const headers = await sessionHeaders(host)
  const token = await csrfToken(origin, host)

  if (token) {
    headers['X-XSRF-TOKEN'] = token
  }

  return new ApiClient({ baseUrl: origin, headers })
}

/**
 * The CSRF token for this session.
 *
 * THE ONE RAW FETCH IN THIS DOMAIN, and it is unavoidable rather than convenient:
 * `/sanctum/csrf-cookie` sits outside `/api`, which `ApiClient` prefixes to every path it
 * is given, and it returns no body — its entire job is to set two cookies. Routing a
 * bodyless cookie-setter through a JSON client would be ceremony around two `Set-Cookie`
 * headers.
 *
 * Failure is silent and returns undefined. A missing token produces a 419 on the write,
 * which every caller here already renders as a sentence; throwing would turn a recoverable
 * write into a broken page.
 */
async function csrfToken(origin: string, host: string): Promise<string | undefined> {
  const jar = await cookies()
  const existing = jar.get('XSRF-TOKEN')?.value

  if (existing) {
    return existing
  }

  try {
    const response = await fetch(`${origin}/sanctum/csrf-cookie`, {
      headers: {
        Accept: 'application/json',
        Origin: `http://${host}`,
        Cookie: await sessionCookies(),
      },
      // A session-bearing response must never be cached, by anything.
      cache: 'no-store',
    })

    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';')
      const separator = pair?.indexOf('=') ?? -1

      if (!pair || separator < 0) {
        continue
      }

      if (pair.slice(0, separator).trim() === 'XSRF-TOKEN') {
        return decodeURIComponent(pair.slice(separator + 1).trim())
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

/**
 * Who is signed in, according to the API.
 *
 * ========================================================================
 * THIS BELONGS IN THE IDENTITY DOMAIN AND IS HERE BECAUSE THAT DOMAIN IS EMPTY.
 * ========================================================================
 *
 * `src/domains/identity/index.ts` exists as a placeholder and is not this change's to
 * fill. Every screen in this change needs to know the signed-in person's roles before it
 * renders anything, and the alternatives were worse: a fourth copy in each domain, or a
 * file in `src/lib/` that three concurrent changes would each create. So it lives at the
 * foundation of the domain that needs it first and is re-exported from that domain's
 * public surface, which is how the consultation and prescribing screens get it too —
 * through the ROUTE layer, as a prop, rather than by importing across domains.
 *
 * WHEN IDENTITY LANDS: move this function and `Staff` there verbatim, re-export from
 * `@/domains/identity`, and delete these two exports from `@/domains/scheduling`. Nothing
 * else moves, because nothing else calls it — the routes do, and they compose domains
 * already.
 *
 * ASKS THE API RATHER THAN READING THE COOKIE. The cookie is opaque, and only the API can
 * say whether the session is still valid: a role change, a deactivation or the console's
 * 20-minute idle timeout all invalidate it server-side and none of them touch the jar.
 *
 * Returns null for a guest rather than redirecting, so the route decides. A route that
 * needs authentication redirects to sign-in; nothing here assumes it knows where that is.
 */
export type Staff = components['schemas']['MeResource']

export async function currentStaff(): Promise<Staff | null> {
  try {
    const api = await readingApi()
    const response = await api.get<{ data: Staff }>('/v1/me')

    return response.data ?? null
  } catch (error) {
    if (error instanceof ApiError) {
      // 401 is the ordinary answer for a signed-out browser and is not worth logging.
      return null
    }

    // Deliberately server-side only and deliberately without the request's details: a
    // member of staff's identifiers should not accumulate in a log because a socket closed.
    console.error('[scheduling] /v1/me did not answer', error)

    return null
  }
}

/**
 * The result of a read that is allowed to fail without taking the page down.
 *
 * A day view whose appointment call failed should say so and keep the rest of itself — the
 * date, the way to the other days, the booking link — on screen. Throwing replaces all of
 * that with the framework's error boundary, which tells a clinician nothing and looks like
 * the clinic's software is broken.
 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string | null }

/**
 * Run a read, and turn a failure into something renderable.
 *
 * `message` is the API's OWN SENTENCE where there is one — `ApiError` has already put RFC
 * 9457 problem details through `humanise()` — and `null` where the request never reached
 * the API. A caller that gets `null` supplies its own sentence, because inventing detail
 * about a failure we did not observe is how a support call starts.
 */
export async function attempt<T>(work: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message }
    }

    console.error('[scheduling] a request to the API did not complete', error)

    return { ok: false, message: null }
  }
}
