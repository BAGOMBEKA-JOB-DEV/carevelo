/**
 * The identity domain's PUBLIC SURFACE.
 *
 * Everything this domain offers the rest of the app is exported here, and nothing else is
 * importable: reaching into ./components or ./api from another domain is a build failure
 * rather than a code-review note. Cross-domain composition belongs in the route layer.
 *
 * ==========================================================================
 * WHAT THIS DOMAIN IS
 *
 * The way in. Twenty-nine routes of clinic console sat behind a session that nobody could
 * obtain — `/sign-in` was a 404, and `accessProblem()` in the tenant domain has been
 * rendering "Your session has ended" with nowhere to send anybody since it was written.
 * This closes that.
 *
 * A STAFF SURFACE, IN CAREVELO'S OWN COLOURS. That is the reverse of the patient portal and
 * it is not an oversight: the clinic is the customer here, not the audience. Nothing in this
 * domain calls `brandStyle()`, so `--brand-*` resolves to Carevelo's `--primary` defaults
 * and a clinic's colours cannot reach these screens by construction. The clinic contributes
 * its ADDRESS, read from the request host — which is also the only thing tenancy is ever
 * resolved from.
 *
 * ENGLISH, PLAIN STRINGS, NO next-intl. Only the patient portal is required to be
 * bilingual (`docs/30-architecture/frontend-nextjs.md` §210).
 *
 * ==========================================================================
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Three screens. Each is a server component that fetches whatever it needs and renders its
 * own full-bleed layout — none of them mounts inside `ConsoleShell`, because two of them
 * are reached by somebody who has no session and the third is reached by somebody the API
 * is refusing. A nav bar of links that all answer 401 is worse than no nav bar.
 *
 *   <SignInScreen       paths error signedOut />
 *   <NewPasswordScreen  paths error changed />
 *   <SignOutScreen      paths />
 *
 * `paths` is `IDENTITY_PATHS` — where the route layer has mounted these screens. This
 * domain hard-codes no URL, so a Server Action can never be talked into redirecting
 * somewhere a form field told it to: every path travels as an encrypted bound argument and
 * is re-checked as a same-origin path inside the action. An open redirect on a SIGN-IN
 * screen is a credential-harvesting page reachable from a link that genuinely starts with
 * the clinic's own address.
 *
 * Everything after `paths` is read straight out of `searchParams` and passed through
 * untouched — the screens own the meaning, the route only carries the values.
 *
 * ==========================================================================
 * THE ONE RULE A FUTURE CHANGE MUST NOT BREAK
 *
 * `/sign-in` MUST NOT REDIRECT A SIGNED-IN VISITOR AWAY. Paired with a "no session, go to
 * sign-in" guard on any console screen, that forms a cycle which fires precisely on the
 * render Next performs for a Server Action redirect — immediately after the action has
 * written the session cookie. Measured in the patient portal at ~800MB per submission and
 * an OOM-killed server. `SignInScreen` carries the full account.
 */

/* ---- Screens ---- */
export { SignInScreen, type SignInScreenProps } from './components/SignInScreen'
export { NewPasswordScreen, type NewPasswordScreenProps } from './components/NewPasswordScreen'
export { SignOutScreen, type SignOutScreenProps } from './components/SignOutScreen'

/*
 * ---- Who is signed in ----
 *
 * Exported because it is the question every other surface in this console will eventually
 * ask: whose name goes in the header, which sections a clinician should be offered, whether
 * to render a screen at all. It returns `null` for a guest rather than redirecting, and
 * that is deliberate — a function that redirected would enlist its caller in exactly the
 * cycle described above.
 *
 * Safe during render: it reads the cookie jar and never writes to it.
 */
export { currentUser } from './api/session'

/*
 * ---- Types, from the generated contract ----
 *
 * `Me` is an alias for the generated `MeResource`, never a hand-written interface that
 * happens to agree with it today.
 */
export type { IdentityPaths, Me } from './model/types'

/*
 * DELIBERATELY NOT EXPORTED: `signInWithPassword`, `changePassword` and `signOut`.
 *
 * All three write to the cookie jar, which is legal in a Server Action and THROWS during
 * render. Exporting them would put a page one honest mistake away from a crash that only
 * appears on the render path. They are reachable through the Server Actions in this
 * domain's own screens, which is the only place they can correctly be called.
 *
 * Nothing here re-implements an authorisation check either. The API decides what a session
 * may do — including refusing everything but this domain's own calls while a password
 * change is outstanding — and these screens render what its refusal means.
 */
