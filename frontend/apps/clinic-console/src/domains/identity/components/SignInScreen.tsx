import { redirect } from 'next/navigation'
import { Button, Field, Input, Notice } from '@carevelo/ui'
import { consoleAddress, signInWithPassword } from '../api/session'
import type { IdentityPaths } from '../model/types'
import { first, samePath, text, withParams, type SearchValue } from './screen'

/**
 * Sign in to the clinic console.
 *
 * ============================================================================
 * THIS PAGE MUST NEVER REDIRECT A SIGNED-IN VISITOR AWAY. READ THIS BEFORE ADDING ONE.
 *
 * The obvious convenience — "you are already signed in, off you go to the console" — pairs
 * with the opposite guard on the destination ("no session, off you go to sign in") to form
 * a CYCLE: two pages redirecting to each other on opposite readings of the same session.
 * That is a latent infinite loop, and it fires exactly when the two readings are
 * momentarily inconsistent — which is what happens on the render Next performs for a
 * Server Action `redirect()`, immediately after the action has written the session cookie.
 *
 * Measured in the patient portal, not theorised: the loop ran server-side inside the
 * action's own response, at roughly 800MB per submission, with an RSC stream that closed
 * early, a browser that never navigated, and an OOM-killed dev server after three
 * attempts. The convenience it bought was that somebody who navigates BACK to the sign-in
 * screen sees the sign-in screen. That is not worth a server.
 *
 * So this screen just renders, always. The console's own screens keep their guards,
 * because a guest reaching one has to go somewhere; this side is the one that can safely
 * be a dead end.
 *
 * ============================================================================
 * CAREVELO'S BRANDING, NOT THE CLINIC'S — WHICH IS THE REVERSE OF THE PATIENT PORTAL.
 *
 * The console is a STAFF surface. The clinic is Carevelo's customer here, not its
 * audience: staff need to know whose software they are using, and a console painted in the
 * clinic's own colours would be claiming to be something the clinic built. So the button is
 * `variant="primary"` (Carevelo's `--primary`) and never `variant="brand"`, and this
 * screen never calls `brandStyle()`.
 *
 * The shared `.auth-*` stylesheet does name `--brand-primary` in two places — the panel's
 * radial glow and the mark tile. That is safe HERE and it is worth saying why rather than
 * leaving the next reader to check: `--brand-primary` DEFAULTS to `var(--primary)` in
 * tokens/colors.css, and a clinic's value only ever arrives as an inline style attribute
 * written by `brandStyle()`. Nothing in this app calls it. The clinic's colours therefore
 * cannot reach this surface, by construction rather than by discipline.
 *
 * WHAT THE CLINIC DOES CONTRIBUTE is its ADDRESS, taken from the host and from nothing
 * else — the same value the API resolves tenancy from. It costs no request, which matters
 * on the one screen that has to work when the session, and therefore every authenticated
 * read, does not; and it is a genuine anti-phishing affordance, because the thing a member
 * of staff should check before typing a password is the address they are typing it into.
 * The clinic's logo could be fetched from the public `GET /v1/tenant` and deliberately is
 * not: decorating the sign-in screen with a remote asset makes signing in depend on a call
 * that has nothing to do with signing in.
 *
 * ============================================================================
 * A PLAIN FORM POST. `<form action={serverAction}>` submits natively before any bundle
 * arrives and with JavaScript switched off, which is why there is no 'use client', no
 * useState and no onSubmit in this file. The front desk of a Ugandan clinic is not the
 * place to make reaching a patient's record depend on a bundle.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */

export type SignInScreenProps = {
  paths: IdentityPaths
  /**
   * The API's own sentence about a failed attempt, carried back on the redirect. A Server
   * Action cannot return a value to the screen it came from without making that screen a
   * client component; see `components/screen.ts`.
   */
  error?: SearchValue
  /** Set by the sign-out screen. Present means "say that the session ended cleanly". */
  signedOut?: SearchValue
}

export async function SignInScreen(props: SignInScreenProps) {
  const { paths } = props
  const error = first(props.error)
  const signedOut = first(props.signedOut)
  const address = await consoleAddress()

  return (
    <div className="auth-page">
      {/* First focusable element: a keyboard user should reach the form without
          traversing the panel. */}
      <a className="skip-link" href="#signin">
        Skip to the sign-in form
      </a>

      {/* Carevelo's side. First in the DOM because it is the context for the form, and
          second on a phone, where the form comes first — see auth.css. */}
      <aside className="auth__brand">
        <div className="auth__mark">
          <span>Carevelo</span>
        </div>

        <div className="auth__lead">
          <h2>The clinic, on one screen.</h2>
          <p>
            The day&rsquo;s schedule, the patient registry, the dispensing queue, the delivery
            board and the payment record — for the staff of one clinic, and for nobody else.
          </p>

          {/*
           * Facts about how this console BEHAVES, not claims about Carevelo's scale. Each
           * one is something a member of staff signing in is better off knowing, and each
           * one is true of the product as built rather than a number we would have to
           * stand behind.
           */}
          <div className="auth__stats">
            <div className="auth__stat">
              <span className="v">20 min</span>
              <span className="k">Idle sign-out</span>
            </div>
            <div className="auth__stat">
              <span className="v">Audited</span>
              <span className="k">Every action</span>
            </div>
            <div className="auth__stat">
              <span className="v">One clinic</span>
              <span className="k">Per session</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="auth__form" id="signin">
        <div className="auth__card">
          <p className="eyebrow">Clinic console</p>
          <h1>Sign in</h1>
          <p className="subtitle">
            For staff of the clinic at <strong>{address}</strong>. Patients sign in on the
            clinic&rsquo;s own portal, not here.
          </p>

          {/*
           * The API's SENTENCE, UNCHANGED, and with no title above it.
           *
           * "No account for that identifier" and "wrong password" come back with the same
           * status and the same words, and the API equalises the timing between them as
           * well. Anything added here — a heading that names the field, a "check your email
           * address" refinement — reopens that hole in full and would let anyone with a
           * browser discover who works at a named clinic. The clinics using Carevelo are
           * frequently each other's local competitors.
           *
           * `announce` because this arrives after a navigation the person started, and a
           * screen reader should hear why they are back here.
           */}
          {error === undefined ? null : (
            <Notice tone="bad" announce>
              {error}
            </Notice>
          )}

          {signedOut === undefined ? null : (
            <Notice tone="info">
              You are signed out. Close this window if you are leaving a shared terminal.
            </Notice>
          )}

          <form action={submitSignIn.bind(null, { paths })} className="auth__fields">
            {/*
             * ONE BOX FOR BOTH IDENTIFIERS, and the choice is made server-side.
             *
             * The API takes an email address OR a phone number and rejects a request
             * carrying both, so something has to choose. A radio group would push that
             * choice onto a clinician between rooms — asking them to understand our
             * validation rules before they can reach a patient's notes — and would create a
             * state of the form in which both are populated. One box has no such state:
             * see `identifierField()` in api/session.ts.
             *
             * `autoComplete="username"` rather than "email" or "tel", because the box is
             * genuinely either and a browser told it is one will refuse to offer the other.
             */}
            <Field
              name="identifier"
              label="Email address or phone number"
              hint="Whichever one this clinic holds for you. A number may be written 0772 123 456 or +256 772 123456."
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  autoComplete="username"
                  spellCheck={false}
                  autoCapitalize="off"
                  maxLength={255}
                  required
                  autoFocus
                />
              )}
            </Field>

            {/* No composition hint on the password, deliberately. A rule stated here tells
                anyone guessing what shape to guess, and this form has no idea what the
                password was actually set to. */}
            <Field name="password" label="Password">
              {(control) => (
                <Input {...control} type="password" autoComplete="current-password" required />
              )}
            </Field>

            <Button type="submit" variant="primary" size="lg" block>
              Sign in
            </Button>
          </form>

          <p className="auth__aside">
            This console signs you out after 20 minutes of inactivity. A terminal left
            unattended at a front desk is the exposure that rule exists for.
          </p>

          <p className="auth__aside">
            Trouble signing in? Ask a clinic administrator at your own clinic — they can
            re-issue your access. Nobody at your clinic and nobody at Carevelo can read your
            password.
          </p>
        </div>
      </main>
    </div>
  )
}

/** Bound into the action by the screen, so no path can arrive from the form. */
type SignInContext = { paths: IdentityPaths }

async function submitSignIn(context: SignInContext, formData: FormData): Promise<void> {
  'use server'

  const { paths } = context
  const back = samePath(paths.signIn, '/sign-in')

  const identifier = text(formData, 'identifier')?.trim() ?? ''
  // NOT trimmed. Leading and trailing space is legal in a password and stripping it here
  // would silently reject a credential the person typed exactly as they set it.
  const password = text(formData, 'password') ?? ''

  const outcome = await signInWithPassword(identifier, password)

  if (!outcome.ok) {
    // The API's sentence travels back verbatim. See the notice above.
    redirect(withParams(back, { error: outcome.message, signed_out: null }))
  }

  if (outcome.passwordChangeRequired) {
    /*
     * An account that did not choose its own password is held to one act until it does.
     * The API enforces that itself — every authenticated call but reading the account,
     * changing the password and signing out is refused while the flag stands — so this
     * redirect is not the control. It is the difference between a member of staff being
     * TOLD why the console is closed to them and discovering it one refusal at a time.
     */
    redirect(samePath(paths.newPassword, '/'))
  }

  redirect(samePath(paths.afterSignIn, '/'))
}
