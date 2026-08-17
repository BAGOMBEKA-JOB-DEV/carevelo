import Link from 'next/link'
import { requestCode, verifyCode, signInWithPassword } from '../api/session'
import type { Tenant } from '@/lib/tenant'

/**
 * Sign in: the clinic's proposition on one side, the form on the other.
 *
 * TWO WAYS IN, ONE DOOR. Email and password is the default, because that is what a
 * clinic administrator at a desk expects and because a password is the credential a
 * member of staff signing in daily should have. A phone code is the second tab, because
 * the business plan is blunt that "most Ugandan clinic staff have a working phone and no
 * reliably checked email address" — and the same is far truer of patients, who consult
 * twice a year and would otherwise arrive at a password they have forgotten.
 *
 * The tab is chosen by a real radio group in CSS, so switching costs no JavaScript and
 * announces itself to a screen reader as what it is.
 *
 * PLAIN FORM POSTS throughout. `<form action={serverAction}>` submits natively before the
 * bundle arrives or with JavaScript switched off, which the performance budget requires:
 * the patient this is built for is on a mid-range Android phone on variable mobile data.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
export function SignInForm({
  tenant,
  phone,
  method,
  error,
}: {
  tenant: Tenant
  // `| undefined` explicitly: a search parameter is genuinely absent or a string, and
  // exactOptionalPropertyTypes keeps those cases distinct rather than letting an
  // accidental undefined pass as "not provided".
  phone?: string | undefined
  method?: string | undefined
  error?: string | undefined
}) {
  const clinic = tenant.trading_name ?? 'this clinic'
  const logo = tenant.branding?.logo_url

  // A pending code wins over the tab: somebody who has just been sent a code is in the
  // middle of that journey and must not be dropped back to the start.
  const awaitingCode = Boolean(phone)
  const codeFirst = awaitingCode || method === 'code'

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

        <div className="auth__lead">
          <h2>Your clinic, on your phone.</h2>
          <p>
            Book a consultation, speak to a clinician by video, voice or chat, read your own
            prescription and follow your medicine to your door — all with {clinic}.
          </p>
        </div>

        {/*
         * Statistics about the JOURNEY, not about Carevelo's scale, and every one of them
         * a fact of how the product is built rather than a claim we would have to stand
         * behind with numbers we do not have.
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
      </aside>

      {/* The form's side. */}
      <main className="auth__form" id="signin">
        <div className="auth__card">
          <h1>Sign in</h1>
          <p className="subtitle">Welcome back. Use the details {clinic} holds for you.</p>

          {error ? (
            <div className="notice notice-bad" style={{ marginTop: 'var(--space-5)' }} role="alert">
              {error}
            </div>
          ) : null}

          {awaitingCode ? (
            <CodeStep phone={phone ?? ''} />
          ) : (
            <>
              {/*
               * The radios sit OUTSIDE both forms, and each method has its own form. One
               * form carrying every field would send an email and a phone together, which
               * the API rejects outright rather than silently preferring one.
               *
               * Both panels render and CSS hides the unchosen one, which is what makes
               * switching work before any JavaScript arrives.
               */}
              <div className="segmented-group" style={{ marginTop: 'var(--space-6)' }}>
                <div className="segmented" role="radiogroup" aria-label="How to sign in">
                  <input
                    type="radio"
                    name="signin-method"
                    value="password"
                    id="m-password"
                    defaultChecked={!codeFirst}
                  />
                  <label htmlFor="m-password">Email &amp; password</label>
                  <input type="radio" name="signin-method" value="code" id="m-code" defaultChecked={codeFirst} />
                  <label htmlFor="m-code">Phone code</label>
                </div>

                <div className="segmented-panel" data-method="password">
                  <PasswordStep autoFocus={!codeFirst} />
                </div>
                <div className="segmented-panel" data-method="code">
                  <PhoneStep clinic={clinic} autoFocus={codeFirst} />
                </div>
              </div>
            </>
          )}

          <p className="auth__aside">
            Trouble signing in? Call {clinic}
            {tenant.contact?.phone ? ` on ${tenant.contact.phone}` : ''}. Staff there can reset
            your details — nobody at {clinic} can see your password.
          </p>

          <p className="auth__aside" style={{ marginTop: 'var(--space-4)', paddingTop: 0, border: 0 }}>
            <Link className="lnk" href="/">
              ← Back to {clinic}
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}

/** Email or phone, with a password. */
function PasswordStep({ autoFocus }: { autoFocus: boolean }) {
  return (
    <form action={submitPassword} className="auth__fields">
      <div className="field">
        <label className="field__label" htmlFor="identifier">
          Email address or phone number
        </label>
        <input
          className="input"
          id="identifier"
          name="identifier"
          // `username` rather than `email`: this field takes either, and a password
          // manager should offer the saved credential for either.
          autoComplete="username"
          type="text"
          placeholder="you@clinic.test or 0772 000 000"
          required
          autoFocus={autoFocus}
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
        {/* No composition hint. A rule stated here tells anyone guessing what shape to
            guess, and this form has no idea what the password was set to. */}
      </div>

      <button className="btn btn-brand btn-block btn-lg" type="submit">
        Sign in
      </button>
    </form>
  )
}

/** Ask for a one-time code. */
function PhoneStep({ clinic, autoFocus }: { clinic: string; autoFocus: boolean }) {
  return (
    <form action={submitPhone} className="auth__fields">
      <div className="field">
        <label className="field__label" htmlFor="phone">
          Phone number
        </label>
        <input
          className="input"
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0772 000 000"
          required
          autoFocus={autoFocus}
        />
        <span className="field__hint">
          The number {clinic} has on file for you. We will send a six-digit code.
        </span>
      </div>

      <button className="btn btn-brand btn-block btn-lg" type="submit">
        Send me a code
      </button>
    </form>
  )
}

/** Spend the code. */
function CodeStep({ phone }: { phone: string }) {
  return (
    <form action={submitCode} className="auth__fields">
      <input type="hidden" name="phone" value={phone} />
      <div className="field">
        <label className="field__label" htmlFor="code">
          Six-digit code
        </label>
        <input
          className="input tnum"
          id="code"
          name="code"
          // A numeric keypad on a phone, and the browser's own SMS autofill.
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
        />
        <span className="field__hint">Sent to {phone}. It expires in five minutes.</span>
      </div>

      <button className="btn btn-brand btn-block btn-lg" type="submit">
        Sign in
      </button>

      <Link className="lnk" href="/sign-in">
        Use a different number
      </Link>
    </form>
  )
}

async function submitPassword(formData: FormData) {
  'use server'

  const { redirect } = await import('next/navigation')

  const identifier = String(formData.get('identifier') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  // One field, two identifiers, and the API refuses a request carrying both — so which
  // one this is gets decided here. An '@' is the whole test: a Ugandan phone number
  // cannot contain one, and an address cannot omit it.
  const field = identifier.includes('@') ? 'email' : 'phone'

  const result = await signInWithPassword(field, identifier, password)

  if (!result.ok) {
    // The API's own sentence, unchanged. It says the same thing for an unknown account and
    // a wrong password, and refining it here would reopen the hole the API closed.
    redirect(`/sign-in?error=${encodeURIComponent(result.message ?? 'Those details did not work.')}`)
  }

  redirect('/account')
}

async function submitPhone(formData: FormData) {
  'use server'

  const { redirect } = await import('next/navigation')

  const phone = String(formData.get('phone') ?? '')
  const result = await requestCode(phone)

  if (!result.ok) {
    redirect(`/sign-in?method=code&error=${encodeURIComponent(result.message ?? 'That did not work.')}`)
  }

  // The same destination whether or not the number is registered. The API is
  // enumeration-safe and this must not undo it by branching on the answer.
  redirect(`/sign-in?phone=${encodeURIComponent(phone)}`)
}

async function submitCode(formData: FormData) {
  'use server'

  const { redirect } = await import('next/navigation')

  const phone = String(formData.get('phone') ?? '')
  const code = String(formData.get('code') ?? '')
  const result = await verifyCode(phone, code)

  if (!result.ok) {
    redirect(
      `/sign-in?phone=${encodeURIComponent(phone)}&error=${encodeURIComponent(result.message ?? 'That code did not work.')}`,
    )
  }

  redirect('/account')
}
