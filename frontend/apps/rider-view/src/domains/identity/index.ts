/**
 * The identity domain's PUBLIC SURFACE.
 *
 * Signing in, signing out, asking the API who is holding the phone — and the
 * session-carrying API client that everything else in this app reaches the API through.
 * Everything not exported here is internal, and reaching past this file is a build
 * failure rather than a code-review note: `.dependency-cruiser.cjs` allows an import of
 * `src/domains/<other>/index.ts` and nothing deeper.
 *
 * ------------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Two screens and one guard, and the guard is the part that is easy to get subtly wrong.
 *
 * 1. `/sign-in` renders `<SignInScreen error={...} />` and NOTHING ELSE. In particular it
 *    must not redirect a rider who already has a session to `/assignments`. That pairing
 *    — this page bouncing the signed-in, `/assignments` bouncing the guest — is a cycle
 *    on two opposite readings of the same session, and it fires exactly when the reading
 *    is momentarily inconsistent: the render Next performs for a Server Action redirect,
 *    immediately after the action has written the session cookie. The patient portal shipped
 *    it and measured the result: ~800MB per submission, an RSC stream that closed early,
 *    a browser that never navigated and an OOM-killed server on the third attempt. The
 *    convenience it buys is that a signed-in person who navigates back to the sign-in
 *    screen sees the sign-in screen. It is not worth it.
 *
 * 2. Every other route calls `currentRider()`, sends `null` to `/sign-in`, and checks
 *    `isRider()` before rendering anything from the delivery domain. The API would refuse
 *    a non-rider anyway — `RiderDeliveryController` filters on `rider_id` and the policy
 *    requires the role — but it refuses by returning an EMPTY LIST, which on a rider's
 *    screen is indistinguishable from a quiet morning.
 *
 * 3. `<SignOutButton name={rider.name} />` goes at the FOOT of a screen, composed by the
 *    route rather than rendered by the delivery domain. The delivery domain has no
 *    business knowing there is such a thing as a session.
 *
 * `readClient()` and `writeClient()` ARE EXPORTED ON PURPOSE, and the delivery domain
 * uses them. See api/http.ts for why this app writes that plumbing once instead of
 * copying it per domain the way the patient portal had to.
 */

/* ---- Screens and controls ---- */
export { SignInScreen } from './components/SignInScreen'
export { SignOutButton } from './components/SignOutButton'

/* ---- The session ---- */
export { signInWithPassword, signOut, currentRider, isRider } from './api/session'
export type { Rider, SignInResult } from './api/session'

/* ---- The way to the API, for the one other domain in this app ----
   `readClient()` is safe during render. `writeClient()` writes to the cookie jar and is
   legal only inside a Server Action; calling it from a render throws, deliberately. */
export { readClient, writeClient, attempt, type Attempt } from './api/http'
