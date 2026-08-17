import { requestCode, verifyCode } from '../api/session'

/**
 * Sign in with a phone number and a one-time code.
 *
 * PLAIN FORM POSTS, no client JavaScript. `<form action={serverAction}>` submits
 * natively when JS has not loaded or is switched off, which is the whole point: the
 * budget says booking and payment must work "without client-side JavaScript wherever
 * possible", and the patient this product is designed for is on a mid-range Android
 * phone on variable mobile data.
 *
 * No password. Requiring one from somebody who consults twice a year produces forgotten
 * passwords, and a forgotten password here is a patient who never reads their
 * prescription.
 */
export function SignInForm({
  phone,
  error,
  clinic,
}: {
  // `| undefined` explicitly: a search parameter is genuinely absent or a string, and
  // exactOptionalPropertyTypes keeps those two cases distinct rather than letting an
  // accidental undefined pass as "not provided".
  phone?: string | undefined
  error?: string | undefined
  clinic: string
}) {
  const awaitingCode = Boolean(phone)

  return (
    <div className="card">
      <h1 className="title">{awaitingCode ? 'Enter your code' : 'Sign in'}</h1>
      <p className="subtitle" style={{ marginTop: 'var(--space-2)' }}>
        {awaitingCode
          ? `We sent a six-digit code to ${phone}.`
          : `Use the phone number ${clinic} has on file for you.`}
      </p>

      {error ? (
        <div className="notice notice-bad" style={{ marginTop: 'var(--space-5)' }} role="alert">
          {error}
        </div>
      ) : null}

      {awaitingCode ? (
        <form action={submitCode} style={{ marginTop: 'var(--space-6)' }}>
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
            <span className="field__hint">The code expires in five minutes.</span>
          </div>
          <button className="btn btn-brand btn-block btn-lg" type="submit" style={{ marginTop: 'var(--space-5)' }}>
            Sign in
          </button>
        </form>
      ) : (
        <form action={submitPhone} style={{ marginTop: 'var(--space-6)' }}>
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
              autoFocus
            />
            <span className="field__hint">We will send you a code by SMS.</span>
          </div>
          <button className="btn btn-brand btn-block btn-lg" type="submit" style={{ marginTop: 'var(--space-5)' }}>
            Send me a code
          </button>
        </form>
      )}
    </div>
  )
}

async function submitPhone(formData: FormData) {
  'use server'

  const { redirect } = await import('next/navigation')

  const phone = String(formData.get('phone') ?? '')
  const result = await requestCode(phone)

  if (!result.ok) {
    redirect(`/sign-in?error=${encodeURIComponent(result.message ?? 'That did not work.')}`)
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

  redirect('/')
}
