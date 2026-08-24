import { redirect } from 'next/navigation'
import { Notice } from '@carevelo/ui'
import { currentUser, signOut } from '../api/session'
import type { IdentityPaths } from '../model/types'
import { samePath, withParams } from './screen'
import { SignOutSubmit } from './SignOutSubmit'

/**
 * Leaving.
 *
 * ============================================================================
 * WHY THIS IS A SCREEN AND NOT A LINK THAT JUST DOES IT.
 *
 * A GET that changes state is a GET that anything can fire: a link prefetch, an `<img>`
 * with the URL in its `src`, a colleague's over-eager browser extension. Signing somebody
 * out is a small harm, but it is a harm that happens silently and looks like the product
 * misbehaving, and there is no way to tell an accidental sign-out from a deliberate one
 * after the fact. So the link is an ordinary navigation to this page, and the sign-out
 * itself is a POST from a form on it.
 *
 * The cost is one press. That is the right trade for a control whose failure mode is
 * "somebody was ejected from the console mid-consultation for no reason".
 *
 * ============================================================================
 * WHY SIGNING OUT MATTERS MORE HERE THAN ON THE PATIENT PORTAL.
 *
 * The console's session idles out after twenty minutes, and twenty minutes is a long time
 * at a front desk in a busy clinic. The exposure is not abstract: an unattended terminal is
 * a signed-in view of a clinic's whole patient registry, standing in a room the public
 * walks through. So this screen exists, it is reachable from every screen in the console
 * frame, and it says what the timeout is rather than leaving somebody to assume the
 * machine looks after itself.
 *
 * A plain form post — no 'use client'. Signing out must not depend on a bundle having
 * arrived, least of all on the connection that has just started failing.
 *
 * ============================================================================
 * SIGNING OUT ALSO CLEARS THIS BROWSER'S NOTE DRAFTS, AND THAT IS WHY THE BUTTON IS A
 * COMPONENT INSTEAD OF A `<Button type="submit">`.
 *
 * Acceptance criterion 7 — "no clinical data persists in client storage beyond the active
 * note draft" — is not satisfied by the server ending a session. The drafts are in this
 * browser's `localStorage`, and the motivating scenario for the criterion is precisely this
 * screen's own: a shared clinic laptop where the previous clinician's note outlives them.
 * The consultations domain owns the sweep (`clearAllDrafts`), and it can only run in a
 * browser — a Server Action cannot reach into storage — so the CALL is in `SignOutSubmit`,
 * a client component whose entire job is to make the clear and the POST happen on one press.
 * Read that file before changing this one: it explains why the clear is on the press and not
 * on mount, and what is and is not guaranteed when the bundle has not arrived.
 *
 * That the sweep existed and nothing called it is the defect this closes. Every part of the
 * design was in place — the function, the export, the contract written out in
 * `consultations/model/drafts.ts` — except the one line that made any of it happen.
 * ============================================================================
 */

export type SignOutScreenProps = {
  paths: IdentityPaths
}

export async function SignOutScreen({ paths }: SignOutScreenProps) {
  /*
   * Read for the greeting only, and a null is not a problem worth showing. Somebody whose
   * session already timed out on the way to this page still pressed "sign out" and still
   * means it: the form below stays, and the action clears this browser's cookies whether or
   * not the API has anything left to end. Redirecting them away would be answering "let me
   * out" with "you are already out, here is a form asking you to come back in".
   */
  const me = await currentUser()

  return (
    <div className="auth-page">
      <a className="skip-link" href="#signout">
        Skip to the sign-out button
      </a>

      <aside className="auth__brand">
        <div className="auth__mark">
          <span>Carevelo</span>
        </div>

        <div className="auth__lead">
          <h2>Leaving this terminal?</h2>
          <p>
            Signing out ends this session on this machine. It does not end your sessions
            anywhere else — changing your password is what does that.
          </p>
        </div>
      </aside>

      <main className="auth__form" id="signout">
        <div className="auth__card">
          <p className="eyebrow">Clinic console</p>
          <h1>Sign out</h1>
          <p className="subtitle">
            {me === null
              ? 'This session has already ended. Signing out here will clear anything this '
                + 'browser is still holding.'
              : `Signed in as ${me.name}.`}
          </p>

          <Notice tone="warn" title="Shared terminals">
            <p>
              This console signs itself out after 20 minutes of inactivity, which is a long
              time in a room the public walks through. If you are stepping away from a shared
              machine, sign out now rather than relying on the timeout.
            </p>
          </Notice>

          <form action={submitSignOut.bind(null, { paths })} className="auth__fields">
            {/* The submit control AND the browser-side half of signing out. See the
                docblock, and SignOutSubmit.tsx. */}
            <SignOutSubmit />
          </form>

          <p className="auth__aside">
            <a className="lnk" href={samePath(paths.afterSignIn, '/')}>
              ← Stay signed in and go back
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}

/** Bound into the action by the screen, so no path can arrive from the form. */
type SignOutContext = { paths: IdentityPaths }

async function submitSignOut(context: SignOutContext, _formData: FormData): Promise<void> {
  'use server'

  // Never throws and never reports a failure — see api/session.ts. Somebody walking away
  // from a terminal must not be held there by an error message about our own request.
  await signOut()

  // A FIXED value rather than a sentence carried on the URL. The sign-in screen turns this
  // into wording of its own, so nothing an attacker can put in a link becomes text on a
  // page that asks for a password. The one string that IS reflected there is the API's own
  // refusal, which has to be, and is the only one.
  redirect(withParams(samePath(context.paths.signIn, '/sign-in'), { signed_out: '1', error: null }))
}
