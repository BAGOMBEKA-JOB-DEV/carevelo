import type { IdentityPaths } from '@/domains/identity'

/**
 * WHERE THE IDENTITY DOMAIN'S SCREENS ARE MOUNTED.
 *
 * The domain hard-codes no URL. Two reasons, and the second is the one that matters:
 *
 *   1. The screens can be mounted anywhere, which keeps the routing tree a routing tree
 *      rather than half the application.
 *   2. A Server Action can never be talked into redirecting somewhere a form field told it
 *      to. Every path in this object travels into an action as an ENCRYPTED BOUND ARGUMENT
 *      — serialised by the framework, not editable in the page — and is re-checked as a
 *      same-origin path inside the action anyway. An open redirect on a SIGN-IN screen is a
 *      credential-harvesting page reachable from a link that genuinely begins with the
 *      clinic's own address.
 *
 * WHY THE FORCED PASSWORD CHANGE LIVES UNDER `/sign-in`. It is part of the way in, not a
 * settings screen: it is reached only by an account the API is refusing, it renders the
 * same full-bleed layout as the sign-in screen rather than the console frame, and somebody
 * reading the address bar should be able to see that they have not got into the console
 * yet. `/settings/password` would say the opposite.
 *
 * `afterSignIn` is the console's own landing page. It must stay a screen that does NOT
 * redirect a guest to `/sign-in` — see the cycle described in
 * `domains/identity/components/SignInScreen.tsx`. Today it does not, because it renders a
 * static map of the console and reads no session at all.
 *
 * THIS FILE IS THE ONE PLACE THESE STRINGS EXIST, so a route that moves moves once. What it
 * still does not guarantee is that each one RESOLVES: `typedRoutes` is not enabled on this
 * app, so a path here without a matching directory under `src/app` is a 404 the compiler
 * cannot see. Until it can, the check is `ls src/app` against the values below.
 */
export const IDENTITY_PATHS: IdentityPaths = {
  signIn: '/sign-in',
  newPassword: '/sign-in/new-password',
  signOut: '/sign-out',
  afterSignIn: '/',
}
