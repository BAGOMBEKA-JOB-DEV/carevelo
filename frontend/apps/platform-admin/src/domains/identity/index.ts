/**
 * The identity domain's PUBLIC SURFACE.
 *
 * Who is signed in, HOW THEY SIGN IN, what their platform role permits, and the
 * session-bearing HTTP clients every other domain reaches the API with. Everything else in
 * this folder is internal, and `.dependency-cruiser.cjs` makes reaching past this file a
 * build failure rather than a code-review note.
 *
 * ------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Every page on this surface but `/sign-in` begins the same way:
 *
 *   const access = await authoriseOperator()
 *
 *   if (access.kind === 'guest') {
 *     redirect(IDENTITY_PATHS.signIn)
 *   }
 *
 *   if (access.kind !== 'operator') {
 *     return <ControlPlaneShell …><AccessNotice operator={access.operator} … /></ControlPlaneShell>
 *   }
 *
 * and then hands `access.can` to the screen it is mounting. The narrowing is what makes the
 * check impossible to skip: there is no way to reach `can` without passing through `kind`
 * first, so a route that forgot to authorise does not compile.
 *
 * `guest` AND `no-role` GET DIFFERENT ANSWERS. One says the browser has no session and is
 * sent to the sign-in screen; the other says the browser HAS a session and this account may
 * not use this surface. Flattening them would leave an operator whose session simply idled
 * out believing the console had been taken away from them.
 *
 * ------------------------------------------------------------
 * THERE IS A SIGN-IN SCREEN NOW, AND WHAT IT HAD TO CLEAR
 *
 * This file used to say the opposite, at length: that a password form here would
 * authenticate the highest-privilege session in the product — the one that can authorise a
 * break-glass grant into a clinic's records — with one factor while looking compliant, and
 * that a session bound to a tenant resolved from the host had no meaning on a host that
 * resolves to no tenant.
 *
 * Both gaps are closed on the API rather than argued away here:
 *
 *   - `POST /v1/platform/auth/sign-in` proves a password and OPENS NO SESSION. Only
 *     `POST /v1/platform/auth/challenge` does, and only when a TOTP code or a recovery code
 *     verifies. `RequireSecondFactor` guards every route in the platform group besides.
 *   - A platform session binds NO tenant, because a platform account has none. That is why
 *     it can be obtained on `admin.carevelo.app` at all.
 *
 * The second factor is an authenticator app and the operator's recovery codes. There is no
 * "send me a code" channel and there must never be one: a code that arrives by SMS is one
 * SIM swap away from being no second factor.
 *
 * ------------------------------------------------------------
 * WHY THE HTTP CLIENTS ARE EXPORTED FROM HERE
 *
 * A session-bearing client is the operator's session expressed as an HTTP header, which
 * makes it this domain's business rather than incidental plumbing each caller copies. The
 * long version — including when it should move to `src/lib/api.ts` instead — is at the top
 * of api/http.ts.
 */

/* ---- Who is signed in, and what they may do ---- */
export { authoriseOperator, currentOperator } from './api/session'
export { capabilitiesFor, platformRoles } from './model/roles'
export type { Access, Capabilities, Operator, PlatformRole } from './model/roles'

/* ---- Signing in: two steps, a password and then a code ---- */
export { SignInScreen, type SignInScreenProps } from './components/SignInScreen'
export { problemFrom, stepFrom } from './model/signIn'
export type { IdentityPaths, SignInProblem, SignInStep } from './model/signIn'

/* ---- The screen for a session this app cannot let in ---- */
export { AccessNotice, type AccessNoticeProps } from './components/AccessNotice'

/* ---- How every domain on this surface reaches the API ----
   `readClient()` during render, `writeClient()` only from a Server Action or a Route
   Handler — it writes to the cookie jar, which throws during render. `attempt()` turns a
   failed read into something a screen can render instead of an error boundary. */
export { attempt, readClient, writeClient, type Attempt } from './api/http'
