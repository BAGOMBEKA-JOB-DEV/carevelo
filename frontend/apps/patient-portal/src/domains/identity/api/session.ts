import { cookies } from 'next/headers'
import { ApiError, humanise, type Problem } from '@carevelo/api-client'
import { requestHost } from '@/lib/tenant'

/**
 * The session calls — signing in with a password, choosing a new one, signing out — and
 * the one piece of real plumbing in this app.
 *
 * THERE IS NO PHONE CODE. Sign-in is an email address and a password, full stop. The
 * one-time-code flow that used to live here is gone from the product and its endpoints
 * are gone from the API, so nothing in this file knows about SMS.
 *
 * THE PROBLEM THIS SOLVES. Authentication is a Sanctum session COOKIE, and the cookie
 * has to end up in the patient's browser. The portal is a separate server from the API,
 * so a server-side call to /auth/sign-in receives `Set-Cookie` here and the browser
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
  // See requestHost(): `host` loses the clinic's subdomain on an action-redirect render.
  const host = (await requestHost()) ?? 'localhost'
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
    Origin: `http://${await requestHost()}`,
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
 * Sign in with an email address or a phone number, and a password.
 *
 * ENUMERATION-SAFE, AND THE UI MUST NOT UNDO IT. The API answers "no account for that
 * address" and "wrong password" with the same status and the same sentence, so a person
 * cannot be confirmed as a patient or a member of staff at a named clinic by anyone who
 * can type an address. Everything below passes that one sentence through: no branching on
 * the field, no second message, no "check your email address" refinement.
 *
 * Exactly one identifier goes up. Sending both is rejected by the API rather than
 * silently preferred, which is why the caller chooses.
 */
export async function signInWithPassword(
  field: 'email' | 'phone',
  identifier: string,
  password: string,
): Promise<StepResult> {
  const xsrf = await csrfToken()
  const response = await call('/v1/auth/sign-in', {
    method: 'POST',
    body: { [field]: identifier, password },
    xsrf,
  })

  // The session cookie arrives here, and has to be re-issued on the portal's own
  // response or the person signs in on the server and stays a guest in the browser.
  await forward(response.cookies)

  if (response.status === 200) {
    return { ok: true }
  }

  return failure(response.status, response.body)
}

/**
 * Change the password on the signed-in account.
 *
 * THE CURRENT PASSWORD IS ALWAYS REQUIRED. There is no relaxed path for the patient whose
 * clinic created their account, because that patient DOES have a current password — the
 * clinic generated one and a member of staff read it to them at the desk. Waiving the
 * check for them would add a second, weaker way to set a credential in exchange for
 * nothing, and the weaker of two credential paths is the one that gets attacked.
 *
 * What that account carries instead is `password_change_required_at`, and it is enforced
 * on the API side rather than here: while it is set, middleware refuses every
 * authenticated request except reading the account, this call, and signing out. A frontend
 * that forgot to send the patient here therefore cannot leave them using the portal on a
 * password the front desk knows. Changing the password clears the flag and ends every
 * other session, which is what closes off anything opened with the initial credential.
 *
 * The confirmation is sent rather than compared here. The API is the one authority on
 * whether two fields match — a check done only in the browser is a check that is not done,
 * and a check done in both places is two rules free to disagree.
 *
 * OBSERVED CONTRACT: POST /v1/me/password takes `current_password`, `password` and
 * `password_confirmation`, and answers 204. The field names are Laravel's own convention —
 * `confirmed` looks for `<field>_confirmation` — and they were briefed to this file as
 * `new_password*` by mistake, which the endpoint answered with "the password field is
 * required" until the journey was actually driven. Written
 * against the agreed shape while the backend half is in flight.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmation: string,
): Promise<StepResult> {
  const xsrf = await csrfToken()

  const response = await call('/v1/me/password', {
    method: 'POST',
    body: {
      current_password: currentPassword,
      password: newPassword,
      password_confirmation: confirmation,
    },
    xsrf,
  })

  // A successful change ends every other session, which can rotate this one's cookie.
  // Forwarding keeps the browser holding whatever is now current rather than the cookie
  // the call just invalidated — otherwise the patient sets a password and is signed out
  // by their own success.
  await forward(response.cookies)

  if (response.status === 204) {
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
