import { headers, cookies } from 'next/headers'
import { ApiClient, ApiError } from '@carevelo/api-client'

/**
 * How this domain reaches the API as the clinician sitting in front of the browser.
 *
 * A DELIBERATE, NAMED DUPLICATE of `src/domains/scheduling/api/gateway.ts`. That file carries
 * the full reasoning — why `ApiClient` alone is not enough server-side, why Host, Cookie and
 * Origin all have to be assembled by hand, why reads and writes are separate clients, and why
 * this is not in `src/lib/api.ts` yet even though `.dependency-cruiser.cjs` already names that
 * file as its eventual home. Read it there rather than here; repeating three hundred words in
 * three places is how three copies drift into three different opinions.
 *
 * The short version: a domain may not reach into another domain's internals, `src/lib/` is
 * app-global and is being written by concurrent changes, and a copy inside the domain is
 * honest and reversible where a shared file three changes each believe they own is not.
 *
 * @see src/domains/scheduling/api/gateway.ts — the reasoning, in full
 * @see docs/40-api/authentication-and-sessions.md
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
 * The result of a read that is allowed to fail without taking the page down.
 *
 * A consultation room whose history call failed must still render the video pane, the note
 * editor and the way to end the encounter. Throwing replaces all of that with the framework's
 * error boundary — in the middle of a consultation, with a patient waiting.
 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string | null }

/**
 * Run a read, and turn a failure into something renderable.
 *
 * `message` is the API's OWN SENTENCE where there is one, and `null` where the request never
 * reached the API. A caller that gets `null` supplies its own sentence, because inventing
 * detail about a failure we did not observe is how a support call starts.
 */
export async function attempt<T>(work: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message }
    }

    // Deliberately without the request's details: nothing about a consultation belongs in a
    // log because a socket closed.
    console.error('[consultations] a request to the API did not complete', error)

    return { ok: false, message: null }
  }
}
