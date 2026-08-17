import { cookies, headers } from 'next/headers'
import { ApiError, humanise, type Problem } from '@carevelo/api-client'

/**
 * The sign-in calls, and the one piece of real plumbing in this app.
 *
 * THE PROBLEM THIS SOLVES. Authentication is a Sanctum session COOKIE, and the cookie
 * has to end up in the patient's browser. The portal is a separate server from the API,
 * so a server-side call to /auth/otp/verify receives `Set-Cookie` here and the browser
 * never sees it — the patient would sign in and immediately be a guest again.
 *
 * So every response's cookies are read and re-issued on the portal's own response
 * through Next's cookies(). The portal and the API share the host (kira.localhost) and
 * cookies ignore ports, so the browser then sends the session on subsequent requests
 * and lib/tenant.ts forwards it server-side.
 *
 * Why not fetch from the browser instead: that needs JavaScript, and booking has to work
 * without it. Everything here is reachable from a plain form post.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/30-architecture/frontend-nextjs.md — the performance budget that rules out
 *      a client-side auth flow
 */

async function apiOrigin(): Promise<string> {
  const host = (await headers()).get('host') ?? 'localhost'
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    return `https://${host}`
  }

  // The CLINIC's subdomain is preserved and only the origin swapped, because tenancy is
  // resolved from the host. Losing the subdomain would resolve the wrong clinic — or
  // none.
  const url = new URL(configured)
  url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`

  return url.origin
}

/**
 * Call the API, forwarding the browser's cookies in and its cookies back out.
 */
async function call(
  path: string,
  init: { method: string; body?: unknown; xsrf?: string | undefined } = { method: 'GET' },
): Promise<{ status: number; body: unknown; cookies: string[] }> {
  const jar = await cookies()
  const origin = await apiOrigin()

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    // Without an Origin the API is not treated as talking to its own frontend and
    // Sanctum never starts a session. This is the header that makes the whole flow
    // stateful.
    Origin: `http://${(await headers()).get('host')}`,
    Cookie: jar
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; '),
  }

  if (init.body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json'
  }

  if (init.xsrf) {
    requestHeaders['X-XSRF-TOKEN'] = init.xsrf
  }

  const request: RequestInit = {
    method: init.method,
    headers: requestHeaders,
    // A sign-in response must never be cached, by anything.
    cache: 'no-store',
  }

  // Assigned rather than passed as undefined: exactOptionalPropertyTypes distinguishes
  // "absent" from "explicitly undefined", and fetch's own types accept only the former.
  if (init.body !== undefined) {
    request.body = JSON.stringify(init.body)
  }

  const response = await fetch(`${origin}/api${path}`, request)

  const body: unknown = await response.json().catch(() => undefined)

  return {
    status: response.status,
    body,
    cookies: response.headers.getSetCookie(),
  }
}

/**
 * Re-issue the API's cookies on the portal's own response.
 */
async function forward(setCookies: string[]): Promise<void> {
  const jar = await cookies()

  for (const raw of setCookies) {
    const [pair, ...attributes] = raw.split(';')
    const separator = pair?.indexOf('=') ?? -1

    if (!pair || separator < 0) {
      continue
    }

    const name = pair.slice(0, separator).trim()
    const value = decodeURIComponent(pair.slice(separator + 1).trim())

    const httpOnly = attributes.some((a) => a.trim().toLowerCase() === 'httponly')

    jar.set({
      name,
      value,
      httpOnly,
      sameSite: 'lax',
      path: '/',
      // Left to the browser's default so the cookie belongs to this host only, which is
      // what keeps one clinic's session off another clinic's subdomain.
    })
  }
}

/** The CSRF cookie, which every unsafe request needs before it will be accepted. */
async function csrfToken(): Promise<string | undefined> {
  const response = await call('/../sanctum/csrf-cookie')

  await forward(response.cookies)

  const jar = await cookies()

  return jar.get('XSRF-TOKEN')?.value
}

export interface StepResult {
  ok: boolean
  /** A sentence for the patient. Never a raw payload. */
  message?: string
  fieldErrors?: Record<string, string>
}

/**
 * Ask for a one-time code.
 *
 * ENUMERATION-SAFE. The API answers identically whether or not the number is
 * registered, because confirming it would disclose that this person is a patient of
 * this clinic — special-category data, handed to anyone who can type a phone number.
 * The message below therefore says the same thing in both cases, and the UI must not
 * "helpfully" improve on it.
 */
export async function requestCode(phone: string): Promise<StepResult> {
  const xsrf = await csrfToken()
  const response = await call('/v1/auth/otp/request', { method: 'POST', body: { phone }, xsrf })

  await forward(response.cookies)

  if (response.status === 202) {
    return { ok: true }
  }

  return failure(response.status, response.body)
}

/**
 * Spend the code and become signed in.
 */
export async function verifyCode(phone: string, code: string): Promise<StepResult> {
  const xsrf = await csrfToken()
  const response = await call('/v1/auth/otp/verify', { method: 'POST', body: { phone, code }, xsrf })

  // The session cookie is in here. Without forwarding it the patient signs in on the
  // server and stays a guest in their browser.
  await forward(response.cookies)

  if (response.status === 200) {
    return { ok: true }
  }

  return failure(response.status, response.body)
}

export async function signOut(): Promise<void> {
  const xsrf = await csrfToken()
  const response = await call('/v1/auth/sign-out', { method: 'POST', xsrf })

  await forward(response.cookies)

  const jar = await cookies()

  // Cleared locally as well: a patient on a borrowed handset pressing sign-out must not
  // depend on the API's response arriving.
  for (const cookie of jar.getAll()) {
    jar.delete(cookie.name)
  }
}

function failure(status: number, body: unknown): StepResult {
  const problem = (body ?? {}) as Problem
  const error = new ApiError(status, problem, humanise(status, problem))

  return {
    ok: false,
    message: error.message,
    fieldErrors: error.fieldErrors,
  }
}
