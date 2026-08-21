import { cookies, headers } from 'next/headers'
import { ApiError, humanise, type Problem, type components } from '@carevelo/api-client'
import { forwardCookies, readClient } from './http'

/**
 * The session calls — signing in, signing out, and asking the API who is holding the
 * phone.
 *
 * ------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 *
 * Authentication is a Sanctum session COOKIE, and the cookie has to end up in the rider's
 * browser. This app is a separate server from the API, so a server-side call to
 * `/v1/auth/sign-in` receives `Set-Cookie` here and the browser never sees it — the rider
 * would sign in and immediately be a guest again.
 *
 * So the two calls that move a session read the response's cookies and re-issue them on
 * this app's own response through Next's `cookies()`. That is also why they use the
 * platform `fetch` rather than `@carevelo/api-client`: the client deliberately does not
 * expose `Set-Cookie`, and `/sanctum/csrf-cookie` is not even under `/api`. Everything
 * that is an ordinary API READ goes through the client, which is where the boundary rule
 * actually bites — see `currentRider()` below.
 *
 * ------------------------------------------------------------
 * WHY THE SIGN-IN FORM ASKS FOR A PHONE NUMBER AND NEVER AN EMAIL ADDRESS
 *
 * `POST /v1/auth/sign-in` accepts EITHER, and exactly one: sending both is rejected as a
 * confused client rather than silently preferred. Which one this surface offers is
 * therefore a product decision, and for a rider it is settled by how the account was
 * made. `InviteStaffRequest` requires `phone` and does not accept an email address at
 * all; `AcceptInvitationRequest` then treats email as `nullable`, with the reason written
 * into the rules: "Most Ugandan clinic staff have a working phone and no reliably checked
 * email address, and requiring one here would stop them joining."
 *
 * So a rider ALWAYS has a phone number on their account and may well have no email
 * address. One field, no method switch, no radio group. A sign-in screen that opens with
 * a choice asks the person to understand our architecture before they can start work.
 *
 * ------------------------------------------------------------
 * THE 12-HOUR IDLE SESSION IS NOT SOMETHING THIS FILE IMPLEMENTS
 *
 * It is server-side, and it is the whole reason the rest of this app can be as thin as it
 * is: a rider on a round must not be signed out mid-delivery, so the timeout is the
 * longest in the product and is paid for by the narrowest scope in the product — three
 * endpoints, one channel, and a resource class with no clinical fields on it. Nothing
 * here should try to "help" by refreshing a session or extending anything; the trade is
 * already made and it is made on the server.
 *
 * @see docs/40-api/authentication-and-sessions.md — the session table and its reasoning
 */

/**
 * Who is signed in.
 *
 * FROM THE CONTRACT, never hand-written. `GET /v1/me` returns `MeResource` and the
 * generated schema is the single description of its shape.
 */
export type Rider = components['schemas']['MeResource']

/** The role the API requires before any of the three rider endpoints will answer. */
const RIDER_ROLE = 'rider'

/**
 * Whether this account may actually do anything on this surface.
 *
 * A SIGNED-IN NON-RIDER IS NOT AN ERROR TO HIDE. A dispatcher who opens the rider app
 * out of curiosity has a perfectly valid session; `RiderDeliveryController::index()`
 * filters on `rider_id`, so they would get an empty list and no explanation. Saying "this
 * app is for riders" is both true and the only thing that helps them.
 */
export function isRider(rider: Rider): boolean {
  return rider.roles.includes(RIDER_ROLE)
}

/**
 * Who the API says is signed in, or null for a guest.
 *
 * ASKS THE API RATHER THAN READING THE COOKIE. A cookie is opaque and cannot know it has
 * been invalidated — sessions end on password change, role change, deactivation and
 * tenant suspension, and a rider whose role was revoked this morning must not be shown a
 * round. Returning null rather than redirecting leaves the decision with the route, which
 * is where it belongs.
 *
 * This is the one session call that goes through `@carevelo/api-client`, because it is an
 * ordinary read: no `Set-Cookie` to catch, a typed body, and RFC 9457 translation worth
 * having.
 */
export async function currentRider(): Promise<Rider | null> {
  try {
    const client = await readClient()
    const response = await client.get<{ data: Rider }>('/v1/me')

    /*
     * UNWRAPPED. An Eloquent API resource nests its payload under `data`. Reading the
     * body flat leaves every field undefined, which does not throw — it renders a
     * signed-in rider as a blank name and reports `roles` as undefined, so `isRider()`
     * would crash somewhere far from here. The portal shipped exactly that bug.
     */
    return response.data ?? null
  } catch (error) {
    /*
     * A 401 is the ordinary answer for a guest and for an expired session alike, and both
     * mean the same thing to every caller: send them to sign in. Anything else is our
     * problem rather than the rider's, and must not be disguised as "signed out" — a
     * rider bounced to the sign-in screen by a 500 would sign in successfully and be
     * bounced again, forever, with nothing on screen to explain it.
     */
    if (error instanceof ApiError && error.status === 401) {
      return null
    }

    console.error('[rider] could not read the signed-in account', error)

    return null
  }
}

/** What a sign-in attempt did, with no exception left for the caller to interpret. */
export interface SignInResult {
  ok: boolean
  /** A sentence for the rider. Never a raw payload. */
  message?: string
  /** Field-level messages, keyed by the API's own field names. */
  fieldErrors?: Record<string, string>
}

/**
 * Sign in with a phone number and a password.
 *
 * ENUMERATION-SAFE, AND THE SCREEN MUST NOT UNDO IT. The API answers "no account for that
 * number" and "wrong password" with the same status and the same sentence, so nobody can
 * discover who rides for a named clinic by typing numbers at this form. Everything below
 * passes that one sentence through: no branching on the field, no second message, no
 * "check your number" refinement.
 */
export async function signInWithPassword(
  phone: string,
  password: string,
): Promise<SignInResult> {
  const xsrf = await mintCsrf()
  const response = await call('/api/v1/auth/sign-in', {
    method: 'POST',
    body: { phone, password },
    xsrf,
  })

  // The session cookie arrives here and has to be re-issued on this app's own response,
  // or the rider signs in on the server and stays a guest in the browser.
  await forwardCookies(response.cookies)

  if (response.status === 200) {
    return { ok: true }
  }

  const problem = (response.body ?? {}) as Problem
  const error = new ApiError(response.status, problem, humanise(response.status, problem))

  return { ok: false, message: error.message, fieldErrors: error.fieldErrors }
}

/**
 * End the session.
 *
 * THE LOCAL JAR IS CLEARED WHETHER OR NOT THE API ANSWERED. A rider signing out is
 * frequently doing it because they are handing the handset to somebody, or because they
 * have finished for the day somewhere with no signal. Making that depend on a round trip
 * would leave a live session on a phone that its holder believes is signed out.
 */
export async function signOut(): Promise<void> {
  const xsrf = await mintCsrf()

  try {
    const response = await call('/api/v1/auth/sign-out', { method: 'POST', xsrf })

    await forwardCookies(response.cookies)
  } catch (error) {
    console.error('[rider] sign-out did not reach the API', error)
  }

  const jar = await cookies()

  for (const cookie of jar.getAll()) {
    jar.delete(cookie.name)
  }
}

/* ------------------------------------------------------------------
   The plumbing. Everything below is private to this module.
   ------------------------------------------------------------------ */

/**
 * The CSRF cookie, which every unsafe request needs before it will be accepted.
 *
 * Separate from `writeClient()`'s copy because this one is used by the two calls that
 * cannot go through `ApiClient` at all, and because sign-in must be able to mint a token
 * for a browser that is holding nothing yet.
 */
async function mintCsrf(): Promise<string | undefined> {
  const response = await call('/sanctum/csrf-cookie')

  await forwardCookies(response.cookies)

  return (await cookies()).get('XSRF-TOKEN')?.value
}

interface Call {
  method: string
  body?: unknown
  xsrf?: string | undefined
}

/**
 * Call the API, forwarding the browser's cookies in and the API's cookies back out.
 *
 * `path` is absolute from the API origin, because these calls straddle the `/api` prefix:
 * `/sanctum/csrf-cookie` is on the `web` middleware group and is not under it.
 */
async function call(
  path: string,
  init: Call = { method: 'GET' },
): Promise<{ status: number; body: unknown; cookies: string[] }> {
  const requestHeaders = await headers()
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost'
  const forwardedScheme = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const scheme = forwardedScheme ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')

  const configured = process.env.NEXT_PUBLIC_API_ORIGIN
  let origin = `https://${host}`

  if (configured) {
    // The CLINIC's subdomain is preserved and only the origin swapped; tenancy is
    // resolved from the host, so losing it resolves the wrong clinic or none at all.
    const url = new URL(configured)
    url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`
    origin = url.origin
  }

  const jar = await cookies()

  const outgoing: Record<string, string> = {
    Accept: 'application/json',
    host,
    // Without an Origin the API is not treated as talking to its own frontend and Sanctum
    // never starts a session. This is the header that makes the whole flow stateful.
    Origin: `${scheme}://${host}`,
    Cookie: jar
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; '),
  }

  if (init.body !== undefined) {
    outgoing['Content-Type'] = 'application/json'
  }

  if (init.xsrf) {
    outgoing['X-XSRF-TOKEN'] = init.xsrf
  }

  const request: RequestInit = {
    method: init.method,
    headers: outgoing,
    // A session-bearing response must never be cached, by anything.
    cache: 'no-store',
  }

  // Assigned rather than passed as undefined: exactOptionalPropertyTypes distinguishes
  // "absent" from "explicitly undefined", and fetch's own types accept only the former.
  if (init.body !== undefined) {
    request.body = JSON.stringify(init.body)
  }

  const response = await fetch(`${origin}${path}`, request)
  const body: unknown = await response.json().catch(() => undefined)

  return { status: response.status, body, cookies: response.headers.getSetCookie() }
}
