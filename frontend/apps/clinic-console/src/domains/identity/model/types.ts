import type { components } from '@carevelo/api-client'

/**
 * The identity domain's types, all of them from the generated contract or about this
 * domain's own routing.
 *
 * NOTHING HERE HAND-DESCRIBES AN API SHAPE. `Me` is an alias for the generated
 * `MeResource` rather than a second interface that happens to agree with it today — a
 * hand-written copy of a contract is a copy that drifts silently, and the one field this
 * whole domain turns on (`password_change_required`) is a boolean, which is exactly the
 * kind of field that drifts without anybody noticing until a member of staff is locked
 * out of a console they are standing in front of.
 */

/**
 * Who is signed in.
 *
 * `password_change_required` is the field that matters here. It is true for an account
 * that did not choose its own password — today that is a patient whose account was opened
 * for them at the registration desk, and any staff account created the same way — and
 * while it stands the API refuses every authenticated call except reading this resource,
 * changing the password, and signing out. A console that ignored it would show a member of
 * staff six sections of 403s with no explanation.
 */
export type Me = components['schemas']['MeResource']

/**
 * WHERE THE ROUTE LAYER HAS MOUNTED THIS DOMAIN'S SCREENS.
 *
 * The domain hard-codes no URL, for the same two reasons the tenant domain does not — and
 * the second is the one that matters. Every path here travels into a Server Action as an
 * ENCRYPTED BOUND ARGUMENT, serialised by the framework rather than posted by the form, and
 * is re-checked as a same-origin path inside the action anyway. An open redirect on a
 * SIGN-IN screen is not a cosmetic defect: it is a credential-harvesting page reachable
 * from a link that genuinely begins with the clinic's own address.
 */
export type IdentityPaths = {
  /** The sign-in screen itself. Every failure comes back here. */
  readonly signIn: string
  /** The forced password change. Where an account carrying the flag is sent. */
  readonly newPassword: string
  /** The sign-out confirmation. */
  readonly signOut: string
  /**
   * Where a member of staff who has just signed in belongs.
   *
   * The console's own landing page, and deliberately NOT a screen that redirects guests
   * away — see the note in `components/SignInScreen.tsx` on the cycle that costs a server.
   */
  readonly afterSignIn: string
}

/**
 * What a sign-in attempt came to.
 *
 * `passwordChangeRequired` is carried on the SUCCESS rather than fetched afterwards,
 * because `POST /v1/auth/sign-in` answers with the same `MeResource` that `GET /v1/me`
 * would — a client that has just signed in wants exactly what it would ask /v1/me for, so
 * the API hands it over and a second round trip would only be a second chance to disagree.
 */
export type SignInOutcome =
  | { readonly ok: true; readonly passwordChangeRequired: boolean }
  /**
   * The API's OWN SENTENCE, and the caller must not improve on it. See
   * `api/session.ts#signInWithPassword`.
   */
  | { readonly ok: false; readonly message: string }

/** What any other step in this domain came to. */
export type StepResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }
