import { redirect } from 'next/navigation'
import { Button, Field, Input, Notice } from '@carevelo/ui'
import { changePassword, currentUser } from '../api/session'
import type { IdentityPaths } from '../model/types'
import { first, samePath, text, withParams, type SearchValue } from './screen'

/**
 * Choosing a password: the screen an account is HELD ON until it does, and the screen
 * anybody may visit to change theirs.
 *
 * ============================================================================
 * WHY THE FORCED CASE EXISTS AT ALL
 *
 * An account can be created for somebody by somebody else, with a password that person
 * chose and said out loud. For as long as that credential stands, two people hold it. The
 * API does not merely advise a change — `RequirePasswordChange` refuses EVERY authenticated
 * call except reading the account, changing the password, and signing out — because on the
 * patient side that credential would let a member of staff sign in as the patient and forge
 * a consent decision the audit trail would attribute to the patient.
 *
 * So this screen is not the control. The API is the control, and it works whether or not
 * this file exists. What this screen provides is the difference between a member of staff
 * being TOLD that the console is closed to them until they choose a password, and
 * discovering it as six sections of unexplained refusals.
 *
 * ============================================================================
 * THE CURRENT PASSWORD IS ASKED FOR EVEN IN THE FORCED CASE, AND THAT IS CORRECT.
 *
 * The temptation is to waive it — they are being forced here, they clearly have not chosen
 * this password, why make them type it. Because they DO have it: somebody issued it to
 * them. Waiving the check would add a second, weaker way to set a credential on exactly the
 * accounts that have never been claimed, and the weaker of two credential paths is the one
 * that gets attacked. `UpdatePasswordRequest` requires it on the API side regardless, so a
 * form that omitted the box would simply fail.
 *
 * ============================================================================
 * ONE SCREEN, TWO FRAMINGS. The person who was sent here cannot leave until they finish,
 * and the person who came here on purpose can leave whenever they like. Those need
 * different words above the same three boxes and nothing else different, so they are one
 * component that reads `password_change_required` rather than two that drift.
 *
 * A plain form post — no 'use client' — for the same reason as the sign-in screen.
 */

export type NewPasswordScreenProps = {
  paths: IdentityPaths
  /** The API's sentence about a rejected change, carried back on the redirect. */
  error?: SearchValue
  /** Present after a successful change. Fixed wording; see the notice below. */
  changed?: SearchValue
}

export async function NewPasswordScreen(props: NewPasswordScreenProps) {
  const { paths } = props
  const error = first(props.error)
  const changed = first(props.changed)

  const me = await currentUser()

  if (me === null) {
    /*
     * A guest cannot change a password, so there is somewhere better to send them.
     *
     * THIS IS NOT HALF OF A CYCLE, and the distinction is the one that cost the patient
     * portal a server. A cycle needs BOTH ends to redirect on opposite readings of the
     * same session. The sign-in screen never redirects anybody, for anything — it is a
     * deliberate dead end — so this edge terminates there and cannot bounce back.
     */
    redirect(samePath(paths.signIn, '/sign-in'))
  }

  const forced = me.password_change_required

  return (
    <div className="auth-page">
      <a className="skip-link" href="#password">
        Skip to the form
      </a>

      <aside className="auth__brand">
        <div className="auth__mark">
          <span>Carevelo</span>
        </div>

        <div className="auth__lead">
          <h2>{forced ? 'One thing first.' : 'Change your password.'}</h2>
          <p>
            {forced
              ? 'This account is using a password somebody else chose for it, so somebody '
                + 'else knows it. Until you replace it, this console will not open.'
              : 'Changing your password ends every other session on this account — on every '
                + 'other device, and at every other terminal.'}
          </p>
        </div>
      </aside>

      <main className="auth__form" id="password">
        <div className="auth__card">
          <p className="eyebrow">{me.name}</p>
          <h1>{forced ? 'Choose your own password' : 'Change your password'}</h1>
          <p className="subtitle">
            {forced
              ? 'The password you were given still works for whoever gave it to you. Replacing '
                + 'it is the only way into the console, and it takes effect immediately.'
              : 'You will stay signed in here. Every other session on this account will end.'}
          </p>

          {/* The API's own sentence, unchanged — including the one that says the current
              password was wrong, which is not enumeration-sensitive because the caller has
              already proved who they are to get here. */}
          {error === undefined ? null : (
            <Notice tone="bad" announce>
              {error}
            </Notice>
          )}

          {changed === undefined ? null : (
            <Notice tone="info" title="Password changed">
              <p>
                Every other session on this account has ended. If somebody else was signed in
                as you, they are not any more.
              </p>
            </Notice>
          )}

          <form action={submitNewPassword.bind(null, { paths })} className="auth__fields">
            <Field
              name="current_password"
              label="Current password"
              hint={
                forced
                  ? 'The one you were given. Asked for even now, because it is what proves it '
                    + 'is you at the keyboard.'
                  : undefined
              }
            >
              {(control) => (
                <Input {...control} type="password" autoComplete="current-password" required />
              )}
            </Field>

            {/* No composition rule stated here. The API is the authority on what it will
                accept, and a rule printed on the form tells anybody guessing what shape to
                guess. Where the API refuses one, its sentence comes back above. */}
            <Field name="password" label="New password">
              {(control) => (
                <Input {...control} type="password" autoComplete="new-password" required />
              )}
            </Field>

            {/* SENT, not compared here. The API is the one authority on whether two fields
                match: a check done only in the browser is a check that is not done, and a
                check done in both places is two rules free to disagree. */}
            <Field name="password_confirmation" label="New password again">
              {(control) => (
                <Input {...control} type="password" autoComplete="new-password" required />
              )}
            </Field>

            <Button type="submit" variant="primary" size="lg" block>
              {forced ? 'Set my password and open the console' : 'Change my password'}
            </Button>
          </form>

          {changed === undefined ? null : (
            <p className="auth__aside">
              <a className="lnk" href={samePath(paths.afterSignIn, '/')}>
                Go to the console →
              </a>
            </p>
          )}

          {/* Reachable from here on purpose. Somebody who cannot complete this — they do
              not have the password they were given, they are at the wrong terminal — must
              still be able to leave, and on a shared front-desk machine that is the more
              urgent of the two. */}
          <p className="auth__aside">
            <a className="lnk" href={samePath(paths.signOut, '/sign-out')}>
              Sign out instead
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}

/** Bound into the action by the screen, so no path can arrive from the form. */
type NewPasswordContext = { paths: IdentityPaths }

async function submitNewPassword(
  context: NewPasswordContext,
  formData: FormData,
): Promise<void> {
  'use server'

  const { paths } = context
  const back = samePath(paths.newPassword, '/')

  // None of the three is trimmed. Space is legal in a password, and stripping it here would
  // reject a credential typed exactly as it was set — or, worse, quietly set a different
  // one from the one the person believes they chose.
  const current = text(formData, 'current_password') ?? ''
  const next = text(formData, 'password') ?? ''
  const confirmation = text(formData, 'password_confirmation') ?? ''

  const result = await changePassword(current, next, confirmation)

  if (!result.ok) {
    redirect(withParams(back, { error: result.message, changed: null }))
  }

  /*
   * Back to this screen rather than straight into the console, and that is a deliberate
   * extra step.
   *
   * A successful change ENDS EVERY OTHER SESSION on the account. The person most likely to
   * be doing this is doing it because they believe somebody else is signed in as them — a
   * terminal left open at a front desk, a handset that changed hands — and that outcome is
   * the whole reason they came. Dropping them onto a dashboard would silently swallow the
   * one fact they were here to establish. The console is one clearly-marked link away.
   */
  redirect(withParams(back, { changed: '1', error: null }))
}
