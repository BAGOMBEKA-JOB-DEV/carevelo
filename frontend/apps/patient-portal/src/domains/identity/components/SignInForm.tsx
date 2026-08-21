import Link from 'next/link'
import { signInWithPassword } from '../api/session'
import type { Tenant } from '@/lib/tenant'

/**
 * Sign in: the clinic's proposition on one side, one form on the other.
 *
 * ONE WAY IN. An email address and a password, and nothing else. The phone one-time-code
 * flow that used to share this screen is gone from the product — its endpoints are gone
 * from the API — so there is no method switch, no radio group and no second panel to
 * choose between. A sign-in screen that opens with a decision is a sign-in screen that
 * asks the patient to understand our architecture before they can reach their records.
 *
 * A PLAIN FORM POST. `<form action={serverAction}>` submits natively before the bundle
 * arrives or with JavaScript switched off, which the performance budget requires: the
 * patient this is built for is on a mid-range Android phone on variable mobile data. That
 * is also why there is no 'use client', no useState and no onSubmit anywhere in this file
 * — every one of them would make the form depend on JavaScript having loaded.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/30-architecture/frontend-nextjs.md — the performance budget that rules out
 *      a client-side auth flow
 */
export function SignInForm({
  tenant,
  error,
}: {
  tenant: Tenant
  // `| undefined` explicitly: a search parameter is genuinely absent or a string, and
  // exactOptionalPropertyTypes keeps those cases distinct rather than letting an
  // accidental undefined pass as "not provided".
  error?: string | undefined
}) {
  const clinic = tenant.trading_name ?? 'this clinic'
  // Optional-chained though the schema marks both required: this renders whatever the API
  // sent, and a panel that throws because a field arrived null is a worse failure than a
  // panel with a letter tile.
  const logo = tenant.branding?.logo_url

  return (
    <div className="auth-page">
      {/* First focusable element: a keyboard user should reach the form without
          traversing the panel. */}
      <a className="skip-link" href="#signin">
        Skip to the sign-in form
      </a>

      {/* The clinic's side. First in the DOM because it is the context for the form —
          whose clinic this is — and second on a phone, where the form comes first. */}
      <aside className="auth__brand">
        <div className="auth__mark">
          {logo ? (
            /*
             * A plain <img>, deliberately: next/image would route a tenant-uploaded
             * asset through Next's optimiser, adding client JS to a surface with a hard
             * budget, for an image the backend already validated, stripped and
             * re-encoded.
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

        {/* Anchored to the bottom of the panel by the stylesheet, which is what gives the
            column its weight — the mark up top, the argument down here. */}
        <div className="auth__lead">
          <h2>Your clinic, on your phone.</h2>
          <p>
            Book a consultation, speak to a clinician by video, voice or chat, read your own
            prescription and follow your medicine to your door — all with {clinic}.
          </p>

          {/*
           * Statistics about the JOURNEY, not about Carevelo's scale, and every one of
           * them a fact of how the product is built rather than a claim we would have to
           * stand behind with numbers we do not have.
           */}
          <div className="auth__stats">
            <div className="auth__stat">
              <span className="v">4</span>
              <span className="k">Steps to care</span>
            </div>
            <div className="auth__stat">
              <span className="v">24/7</span>
              <span className="k">Book any time</span>
            </div>
            <div className="auth__stat">
              <span className="v">100%</span>
              <span className="k">Paid to the clinic</span>
            </div>
          </div>
        </div>
      </aside>

      {/* The form's side. */}
      <main className="auth__form" id="signin">
        <div className="auth__card">
          <p className="eyebrow">Patient portal</p>
          <h1>Sign in</h1>
          <p className="subtitle">Welcome back. Use the details {clinic} holds for you.</p>

          {error ? (
            /* role="alert" because this arrives after a navigation the patient started,
               and a screen reader should hear why they are back here. */
            <div className="notice notice-bad" role="alert">
              {error}
            </div>
          ) : null}

          <form action={submitSignIn} className="auth__fields">
            <div className="field">
              <label className="field__label" htmlFor="email">
                Email address
              </label>
              <input
                className="input"
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                autoFocus
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="password">
                Password
              </label>
              <input
                className="input"
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
              {/* No composition hint. A rule stated here tells anyone guessing what shape
                  to guess, and this form has no idea what the password was set to. */}
            </div>

            <button className="btn btn-brand btn-block btn-lg" type="submit">
              Sign in
            </button>
          </form>

          <p className="auth__aside">
            Trouble signing in? Call {clinic}
            {tenant.contact?.phone ? ` on ${tenant.contact.phone}` : ''}. Staff there can reset
            your details — nobody at {clinic} can see your password.
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

async function submitSignIn(formData: FormData) {
  'use server'

  const { redirect } = await import('next/navigation')

  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const result = await signInWithPassword('email', email, password)

  if (!result.ok) {
    // THE API'S OWN SENTENCE, UNCHANGED. It answers "no account for that address" and
    // "wrong password" with the identical status and the identical body, so that nobody
    // can discover who is a patient or a member of staff at a named clinic by typing
    // addresses at this form. A "check your email address" refinement here would reopen
    // exactly that hole, which is why nothing below branches on the field or the status.
    redirect(`/sign-in?error=${encodeURIComponent(result.message ?? 'Those details did not work.')}`)
  }

  redirect('/account')
}
