import Link from 'next/link'
import { changePassword } from '../api/session'
import type { Tenant } from '@/lib/tenant'

/**
 * Choose a password: the same split screen as sign-in, one job.
 *
 * WHO SEES THIS. A patient whose clinic created their account at the front desk. Somebody
 * there generated a temporary password and read it out, which means the credential
 * guarding this person's consultations and prescriptions is currently known to a member of
 * staff. That is the whole reason this screen exists, and the copy below says so plainly
 * rather than calling it a formality — a patient who understands why is a patient who
 * chooses a password rather than reusing the one on the card.
 *
 * The account carries `password_change_required_at` until they do, and the API refuses
 * every other authenticated request while it is set, so this is not a screen anyone can
 * skip past. Reached while already signed in, which is why it asks for the temporary
 * password as proof rather than for an email address.
 *
 * THREE FIELDS, AND THE FIRST IS NOT A FORMALITY. The current password is required by the
 * API for this call as for any other password change. There is no relaxed path for the
 * clinic-issued case, because this patient does have a current password — the clinic's —
 * and a second, weaker way to set a credential would simply be the way in that gets used.
 *
 * A PLAIN FORM POST, for the same reason as sign-in: it has to work before the JavaScript
 * bundle arrives and with JavaScript switched off. No 'use client', no useState, no
 * onSubmit — and no browser-side "passwords must match" check either, because the API is
 * the one authority on that and two implementations of one rule are free to disagree.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
export function SetPasswordForm({
  tenant,
  error,
}: {
  tenant: Tenant
  // `| undefined` explicitly: a search parameter is genuinely absent or a string, and
  // exactOptionalPropertyTypes keeps those two cases distinct.
  error?: string | undefined
}) {
  const clinic = tenant.trading_name ?? 'this clinic'
  const logo = tenant.branding?.logo_url

  return (
    <div className="auth-page">
      <a className="skip-link" href="#set-password">
        Skip to the password form
      </a>

      <aside className="auth__brand">
        <div className="auth__mark">
          {logo ? (
            /*
             * A plain <img>, deliberately: next/image would route a tenant-uploaded asset
             * through Next's optimiser, adding client JS to a surface with a hard budget,
             * for an image the backend already validated, stripped and re-encoded.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={clinic} />
          ) : (
            <span className="auth__mark-tile" aria-hidden="true">
              {clinic.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span>{clinic}</span>
        </div>

        <div className="auth__lead">
          <h2>One password, only yours.</h2>
          <p>
            {clinic} set up your account so you could be seen quickly, and the password they
            gave you is one a member of staff knows. Choose your own now and it is yours
            alone — every other device signed in with the old one is signed out.
          </p>

          <div className="auth__stats">
            <div className="auth__stat">
              <span className="v">1</span>
              <span className="k">Step to finish</span>
            </div>
            <div className="auth__stat">
              <span className="v">24/7</span>
              <span className="k">Change it any time</span>
            </div>
            <div className="auth__stat">
              <span className="v">0</span>
              <span className="k">Staff can see it</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="auth__form" id="set-password">
        <div className="auth__card">
          <p className="eyebrow">Patient portal</p>
          <h1>Choose your password</h1>
          <p className="subtitle">
            {clinic} set you up with a temporary password. Choose your own before you use the
            portal — while the clinic&rsquo;s password still works, a member of staff knows a
            way into this account.
          </p>

          {error ? (
            <div className="notice notice-bad" role="alert">
              {error}
            </div>
          ) : null}

          <form action={submitPassword} className="auth__fields">
            <div className="field">
              <label className="field__label" htmlFor="current_password">
                The password {clinic} gave you
              </label>
              <input
                className="input"
                id="current_password"
                name="current_password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="password">
                New password
              </label>
              <input
                className="input"
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
              {/* No composition rule stated. It would tell anyone guessing what shape to
                  guess, and the API is where the real rule lives — if the password is
                  refused, the API's own sentence says why. */}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="password_confirmation">
                Confirm new password
              </label>
              <input
                className="input"
                id="password_confirmation"
                name="password_confirmation"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>

            <button className="btn btn-brand btn-block btn-lg" type="submit">
              Save password
            </button>
          </form>

          <p className="auth__aside">
            Nobody at {clinic} can see the password you choose here. If you forget it, staff
            can only set a new one for you to replace.
          </p>

          <p className="auth__aside">
            <Link className="lnk" href="/">
              ← Back to {clinic}
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}

async function submitPassword(formData: FormData) {
  'use server'

  const { redirect } = await import('next/navigation')

  // Not trimmed, unlike the email address on sign-in: a space is a legitimate character
  // in a password, and quietly removing one would reject a password the patient typed
  // exactly as they meant to.
  const current = String(formData.get('current_password') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirmation = String(formData.get('password_confirmation') ?? '')

  const result = await changePassword(current, password, confirmation)

  if (!result.ok) {
    // The API's own sentence, unchanged — including its validation messages, which are the
    // only place the real password rule is written down, and its "that is not your current
    // password", which this screen has no way to know better than.
    redirect(`/set-password?error=${encodeURIComponent(result.message ?? 'That did not work.')}`)
  }

  // The flag is cleared and the session is current, so the portal is open again.
  redirect('/account')
}
