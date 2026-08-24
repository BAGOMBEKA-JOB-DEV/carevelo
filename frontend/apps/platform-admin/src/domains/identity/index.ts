/**
 * The identity domain's PUBLIC SURFACE.
 *
 * Who is signed in, what their platform role permits, and the session-bearing HTTP
 * clients every other domain reaches the API with. Everything else in this folder is
 * internal, and `.dependency-cruiser.cjs` makes reaching past this file a build failure
 * rather than a code-review note.
 *
 * ------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Every page on this surface begins the same way, and there is no public screen:
 *
 *   const access = await authoriseOperator()
 *
 *   if (access.kind !== 'operator') {
 *     return <ControlPlaneShell …><AccessNotice access={access} /></ControlPlaneShell>
 *   }
 *
 * and then hands `access.can` to the screen it is mounting. The narrowing is what makes
 * the check impossible to skip: there is no way to reach `can` without passing through
 * `kind` first, so a route that forgot to authorise does not compile.
 *
 * ------------------------------------------------------------
 * WHY THE HTTP CLIENTS ARE EXPORTED FROM HERE
 *
 * A session-bearing client is the operator's session expressed as an HTTP header, which
 * makes it this domain's business rather than incidental plumbing each caller copies. The
 * long version — including when it should move to `src/lib/api.ts` instead — is at the top
 * of api/http.ts.
 *
 * ------------------------------------------------------------
 * THERE IS NO SIGN-IN SCREEN AND THAT IS DELIBERATE
 *
 * The API publishes no TOTP endpoint, and mandatory TOTP is what
 * docs/40-api/authentication-and-sessions.md § Second factor requires of a platform
 * operator. A password form here would authenticate the highest-privilege session in the
 * product with one factor while looking compliant. `<AccessNotice>` says so on screen; the
 * reasoning is written out in full in components/AccessNotice.tsx.
 */

/* ---- Who is signed in, and what they may do ---- */
export { authoriseOperator, currentOperator } from './api/session'
export { capabilitiesFor, platformRoles } from './model/roles'
export type { Access, Capabilities, Operator, PlatformRole } from './model/roles'

/* ---- The screen for a request this app cannot serve ---- */
export { AccessNotice } from './components/AccessNotice'

/* ---- How every domain on this surface reaches the API ----
   `readClient()` during render, `writeClient()` only from a Server Action or a Route
   Handler — it writes to the cookie jar, which throws during render. `attempt()` turns a
   failed read into something a screen can render instead of an error boundary. */
export { attempt, readClient, writeClient, type Attempt } from './api/http'
