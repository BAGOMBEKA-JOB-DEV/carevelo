import { cookies, headers } from 'next/headers'
import { ApiClient, ApiError, humanise, type Problem } from '@carevelo/api-client'
import type { Me, SignInOutcome, StepResult } from '../model/types'

/**
 * The session calls — signing in, changing a password under duress, signing out — and the
 * one piece of real plumbing this domain owns.
 *
 * ============================================================================
 * WHY THIS IS NOT `domains/tenant/api/http.ts`
 *
 * The console already has a server-side transport with session and CSRF handling, and it
 * is the right shape: `tenantHost()`, `apiOrigin()`, `sessionHeaders()`, a cookie
 * `forward()` and a `/sanctum/csrf-cookie` fetch. Everything below follows it deliberately
 * — the same names, the same order, the same decisions — so that the two read as one idea
 * rather than two competing ones.
 *
 * It could not simply be IMPORTED, for two independent reasons, and both are worth stating
 * because the obvious review note is "why did you not reuse it":
 *
 *   1. `no-cross-domain-internals` forbids `domains/identity` from reaching into
 *      `domains/tenant/api/http.ts`, and the tenant domain's `index.ts` deliberately
 *      exports none of it — that transport is internal plumbing with exactly one way in.
 *
 *   2. MORE IMPORTANTLY, it cannot do this job. `ApiClient` returns a parsed BODY and
 *      throws on failure; it does not expose response headers. Sign-in's entire value is
 *      in the `Set-Cookie` headers of the sign-in response itself, and the tenant
 *      transport only ever forwards the cookies from the `/sanctum/csrf-cookie` call. A
 *      write that authenticates is structurally different from a write that changes a
 *      record, and the difference is exactly the headers `ApiClient` hides.
 *
 * The right long-term home is `src/lib/api.ts` — `domains/tenant/api/http.ts` says so
 * itself, and `.dependency-cruiser.cjs` already names that module as the one allowed to
 * hold it. There are now THREE copies in this app (tenant, notifications, and this one),
 * which is one more than the threshold that file set. That extraction is a change to
 * `src/lib`, which this piece of work does not own; it is named in the report instead of
 * being done quietly here.
 *
 * ============================================================================
 * THE MECHANIC EVERYTHING ELSE DEPENDS ON
 *
 * Authentication is a Sanctum session COOKIE, and the cookie has to end up in the
 * BROWSER. The console is a separate server from the API, so a server-side call to
 * /auth/sign-in receives `Set-Cookie` here and the browser never sees it — a clinic
 * administrator would sign in on the server and remain a guest at their own desk, which
 * looks exactly like a wrong password and is the single easiest thing to get wrong in this
 * file.
 *
 * So every response's cookies are read and re-issued on the console's own response through
 * Next's `cookies()`. The console and the API share the host (`kira.localhost`) and cookies
 * ignore ports, so the browser then sends the session on every subsequent request and
 * `domains/<domain>/api/http.ts` forwards it server-side.
 *
 * Why not fetch from the browser instead: that needs JavaScript, and the front desk of a
 * Ugandan clinic is not the place to make signing in depend on a bundle arriving. Every
 * call below is reachable from a plain form post.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */

/**
 * The host this request was really made to.
 *
 * x-forwarded-host FIRST, and this is not belt-and-braces — it is the only header that
 * survives. On the render Next performs when a Server Action calls `redirect()`, the plain
 * `host` header degrades from `kira.localhost:3001` to `localhost:3001`: the clinic's
 * subdomain, which is the entire basis of tenancy, is gone. Sign-in is a Server Action that
 * ends in a redirect, so this is not an edge case here — it is THE path, and getting it
 * wrong means the API resolves no tenant and a member of staff who typed their password
 * correctly is told their details do not match an account at a clinic that, as far as the
 * request was concerned, does not exist.
 *
 * Measured in the patient portal on exactly this failure; see its `src/lib/tenant.ts`.
 */
async function tenantHost(): Promise<string> {
  const requestHeaders = await headers()

  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost'
}

/**
 * The clinic's own subdomain, for a screen that wants to say which console this is.
 *
 * Read from the host and from nowhere else, which is the same rule the API applies. It
 * costs no request — which is the point on the one screen that has to work when the
 * session, and therefore every authenticated read, does not.
 */
export async function consoleAddress(): Promise<string> {
  return tenantHost()
}

/**
 * The API origin for this request, with the CLINIC'S SUBDOMAIN PRESERVED.
 *
 * In production the console and the API share a host, so the address is already right.
 * Locally they differ by port, and the subdomain has to be carried across the swap or the
 * API resolves no tenant at all.
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
 * The headers that make a server-side call authenticate as the person at the keyboard.
 *
 * Without an `Origin` the API is not treated as talking to its own frontend and Sanctum
 * never starts a session from it at all — `auth:sanctum` falls through to the bearer
 * tokens this architecture deliberately does not use, and every call answers 401. This is
 * the header that makes the whole flow stateful.
 *
 * The scheme is not significant: Sanctum strips it and compares host and port, which is
 * why `http://` here is correct against an https deployment.
 */
async function sessionHeaders(host: string): Promise<Record<string, string>> {
  const jar = await cookies()

  return {
    Accept: 'application/json',
    Origin: `http://${host}`,
    Cookie: jar
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; '),
  }
}

/**
 * Re-issue the API's cookies on the console's own response.
 *
 * ONLY LEGAL INSIDE A SERVER ACTION. `cookies().set()` throws during render, which is why
 * nothing on a rendered page may call this or anything that calls it.
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
      // That is what keeps one clinic's session off another clinic's subdomain, and it is
      // the reason a shared parent-domain cookie must never be introduced here.
    })
  }
}

/**
 * A CSRF token for this session, and the cookies that come with it.
 *
 * `/sanctum/csrf-cookie` sits OUTSIDE `/api`, returns no body and exists only to set two
 * cookies, so there is nothing for `ApiClient` to translate and no response type to
 * import. That is why this one call uses the platform `fetch`: routing a bodyless
 * cookie-setter through a JSON client would be ceremony around two `Set-Cookie` headers.
 * `no-restricted-imports` and the `api-only-through-the-client` boundary both name
 * third-party HTTP clients; the platform fetch is neither.
 */
async function csrfToken(host: string, origin: string): Promise<string | undefined> {
  const response = await fetch(new URL('/sanctum/csrf-cookie', origin), {
    headers: await sessionHeaders(host),
    // A session-bearing response must never be cached, by anything.
    cache: 'no-store',
  })

  await forward(response.headers.getSetCookie())

  const jar = await cookies()

  return jar.get('XSRF-TOKEN')?.value
}

/**
 * One unsafe call to the API, with the session going out and the session coming back.
 *
 * Returns the status, the parsed body and the `Set-Cookie` headers, because every caller
 * here has to do something with all three — which is precisely what `ApiClient` cannot
 * give.
 */
async function call(
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown; cookies: readonly string[] }> {
  const host = await tenantHost()
  const origin = await apiOrigin(host)

  // FIRST, and the ordering is load-bearing: this writes the XSRF-TOKEN and session
  // cookies into the jar, and `sessionHeaders()` below has to read the jar as it is
  // AFTERWARDS. Assembling the headers first would send the jar as it was a moment ago,
  // and the API would answer 419 to a token it had itself just issued.
  const token = await csrfToken(host, origin)

  const requestHeaders = await sessionHeaders(host)
  requestHeaders['X-Requested-With'] = 'XMLHttpRequest'

  if (token) {
    requestHeaders['X-XSRF-TOKEN'] = token
  }

  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json'
  }

  const request: RequestInit = {
    method: 'POST',
    headers: requestHeaders,
    // A session-bearing response must never be cached, by anything.
    cache: 'no-store',
  }

  if (body !== undefined) {
    // Assigned rather than passed as `undefined`: exactOptionalPropertyTypes distinguishes
    // "absent" from "explicitly undefined", and fetch's own types accept only the former.
    request.body = JSON.stringify(body)
  }

  const response = await fetch(new URL(`/api${path}`, origin), request)

  return {
    status: response.status,
    body: (await response.json().catch(() => undefined)) as unknown,
    cookies: response.headers.getSetCookie(),
  }
}

/**
 * Sign in with an email address or a phone number, and a password.
 *
 * ============================================================================
 * ENUMERATION-SAFE, AND THIS FUNCTION MUST NOT UNDO IT.
 *
 * The API answers "no account for that identifier" and "wrong password" with the identical
 * status and the identical body, and equalises the timing between them as well — it
 * compares against a decoy digest when there is no account rather than short-circuiting on
 * the null. That is not incidental hardening. The clinics using Carevelo are frequently
 * each other's local competitors, and confirming that a named person works at a named
 * clinic is information one of them would pay for.
 *
 * So the sentence the API wrote goes back to the screen UNCHANGED. Nothing below branches
 * on the field, adds a second message, or refines it into "check your email address". Any
 * such refinement reopens the hole in full, and does so in a way that no test will catch
 * because both paths still "work".
 *
 * ============================================================================
 * EXACTLY ONE IDENTIFIER GOES UP.
 *
 * `SignInRequest` declares `email` as `prohibits:phone`: sending both is rejected rather
 * than silently resolved, because two requests that look identical must not sign in as
 * different people. The caller therefore chooses, and `identifierField()` below makes that
 * choice structurally rather than by asking the person at the keyboard to declare it.
 */
export async function signInWithPassword(
  identifier: string,
  password: string,
): Promise<SignInOutcome> {
  const field = identifierField(identifier)
  const response = await call('/v1/auth/sign-in', { [field]: identifier, password })

  // THE SESSION COOKIE ARRIVES HERE. Re-issued on the console's own response, or the
  // administrator signs in on the server and stays a guest in the browser.
  await forward(response.cookies)

  if (response.status === 200) {
    const body = response.body as { data?: Me } | undefined

    return { ok: true, passwordChangeRequired: body?.data?.password_change_required === true }
  }

  return { ok: false, message: sentence(response.status, response.body) }
}

/**
 * Which field identifies the account: `email` or `phone`.
 *
 * DECIDED HERE RATHER THAN BY THE PERSON SIGNING IN. The screen offers one box, because a
 * sign-in screen that opens with a radio group asks a clinician between rooms to
 * understand the API's validation rules before they can reach a patient's notes. An `@` is
 * present in every email address and in no Ugandan phone number — the API normalises
 * `0772 123 456`, `+256 772 123456` and `(+256) 772-123-456` to one E.164 identity, and
 * none of those forms contains one — so the test is total over the inputs that can succeed,
 * and an input that is neither fails validation on whichever field it was sent as, with the
 * API's own sentence about the format.
 *
 * The structural benefit is the one that matters: with one box there is no state of the
 * form in which BOTH identifiers are populated, so the `prohibits` rule can never fire at a
 * member of staff who has done nothing wrong.
 */
function identifierField(identifier: string): 'email' | 'phone' {
  return identifier.includes('@') ? 'email' : 'phone'
}

/**
 * Change the password on the signed-in account.
 *
 * THE CURRENT PASSWORD IS ALWAYS REQUIRED, including on the forced-change path, and that is
 * the API's rule rather than this screen's politeness. An account carrying
 * `password_change_required` DOES have a current password — somebody chose it and said it
 * out loud — so waiving the check would add a second, weaker way to set a credential in
 * exchange for nothing, and the weaker of two credential paths is the one that gets
 * attacked.
 *
 * The confirmation is SENT rather than compared here. The API is the one authority on
 * whether two fields match: a check done only in the browser is a check that is not done,
 * and a check done in both places is two rules free to disagree.
 *
 * CONTRACT: `POST /v1/me/password` takes `current_password`, `password` and
 * `password_confirmation` — Laravel's own `confirmed` convention, which looks for
 * `<field>_confirmation` — and answers 204.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmation: string,
): Promise<StepResult> {
  const response = await call('/v1/me/password', {
    current_password: currentPassword,
    password: newPassword,
    password_confirmation: confirmation,
  })

  // A successful change ENDS EVERY OTHER SESSION and rotates the remember-me token, which
  // can rotate this session's cookie too. Forwarding keeps the browser holding whatever is
  // now current rather than the cookie the call just invalidated — otherwise a member of
  // staff sets a password and is signed out by their own success, on the one screen where
  // that reads as the product having lost their new password.
  await forward(response.cookies)

  if (response.status === 204) {
    return { ok: true }
  }

  return { ok: false, message: sentence(response.status, response.body) }
}

/**
 * End this session.
 *
 * Never reports a failure, and that is deliberate. A member of staff walking away from a
 * shared terminal at a front desk pressed this because they are leaving; whether the API's
 * response arrived is not their problem and must not become a screen they have to read.
 */
export async function signOut(): Promise<void> {
  const response = await call('/v1/auth/sign-out')

  await forward(response.cookies)

  const jar = await cookies()

  // Cleared locally as well, for exactly the case above: the browser must stop holding the
  // session even if the call never reached the API. The server-side session may outlive it
  // by up to the idle timeout, which is a smaller exposure than a signed-in cookie left on
  // an unattended machine.
  for (const cookie of jar.getAll()) {
    jar.delete(cookie.name)
  }
}

/**
 * Who is signed in, according to the API.
 *
 * Asks the API rather than reading the cookie, because the cookie is opaque and the API is
 * the only thing that can say whether the session is still valid — a role change, a
 * deactivation, a suspension or twenty idle minutes all end it server-side, and the cookie
 * looks exactly the same afterwards.
 *
 * Returns null for a guest rather than redirecting, so the caller decides. That is not a
 * style preference: a function that redirected would make every screen that reads it a
 * participant in a redirect cycle, and this domain has one screen — the sign-in screen —
 * that must NEVER redirect. See `components/SignInScreen.tsx`.
 *
 * Safe during render. It reads the cookie jar and never writes to it, and it goes through
 * `ApiClient` because it is an ordinary typed read with nothing unusual about it.
 */
export async function currentUser(): Promise<Me | null> {
  const host = await tenantHost()
  const client = new ApiClient({
    baseUrl: await apiOrigin(host),
    headers: await sessionHeaders(host),
  })

  try {
    // UNWRAPPED. `MeResource` is an Eloquent API resource and nests its payload under
    // `data`; reading the body flat leaves every field undefined, which renders as a blank
    // name rather than failing loudly.
    const response = await client.get<{ data: Me }>('/v1/me')

    return response.data
  } catch (error) {
    // A 401 is the ordinary answer for a guest and is not worth a log line. Anything else
    // is ours, and is logged server-side WITHOUT the request's details: a clinic's
    // identifiers should not accumulate in a log because a socket closed.
    if (!(error instanceof ApiError) || error.status !== 401) {
      console.error('[identity] could not read the signed-in account', error)
    }

    return null
  }
}

/**
 * The sentence to show, from an RFC 9457 problem document.
 *
 * `humanise()` prefers the API's own field message, which is what carries the
 * enumeration-safe wording through unaltered. The fallback is used only when the failure
 * carried no words of its own.
 */
function sentence(status: number, body: unknown): string {
  const problem = (body ?? {}) as Problem

  return humanise(status, problem)
}
