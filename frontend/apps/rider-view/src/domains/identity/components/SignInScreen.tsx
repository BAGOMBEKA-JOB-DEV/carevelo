import { Button, Field, Icon, Input, Notice } from '@carevelo/ui'
import { signInWithPassword } from '../api/session'

/**
 * Sign in — one column, two fields, one button.
 *
 * ------------------------------------------------------------
 * NOT THE SPLIT SCREEN THE PATIENT PORTAL USES
 *
 * `.auth-page` is a 1.05fr/1fr grid whose left panel is the CLINIC's proposition, tinted
 * with `--brand-primary`. Neither half of that belongs here. This surface is Carevelo's
 * own and carries no `--brand-*` tokens at all — the clinic's logo appears on a patient's
 * screen, and the clinic's colours never appear on a member of staff's — and the device
 * is a phone in a rider's hand, where a proposition panel is a screenful of scrolling
 * between them and the password field.
 *
 * So this is the `.fieldview` frame the rest of the app wears: 560px at most, one column,
 * centred. It is deliberately NOT `<FieldShell>` — that renders the tab bar, and a tab
 * bar on the sign-in screen offers two destinations that will both bounce straight back
 * here. Navigation you cannot use is navigation that teaches you to distrust the screen.
 *
 * ------------------------------------------------------------
 * A PLAIN FORM POST, AND EVERY WORD OF THAT IS LOAD-BEARING
 *
 * `<form action={serverAction}>` submits natively before the bundle arrives and with
 * JavaScript switched off entirely. There is no 'use client' in this file, no useState
 * and no onSubmit, and each of those would make signing in depend on a bundle having
 * finished downloading — over the connection this app is built for, at the start of a
 * shift, standing outside a pharmacy.
 *
 * ------------------------------------------------------------
 * A PHONE NUMBER, NOT AN EMAIL ADDRESS
 *
 * See `../api/session.ts` for the whole reasoning. In short: `InviteStaffRequest`
 * requires a phone number and does not take an email address, and email is nullable
 * everywhere in this product because most Ugandan clinic staff do not reliably have one.
 * A rider always has the identifier this field asks for.
 */
export function SignInScreen({
  error,
}: {
  /* Explicitly `| undefined`: a search parameter is genuinely absent or a string, and
     exactOptionalPropertyTypes keeps those cases distinct rather than letting an
     accidental undefined pass as "not provided". */
  error?: string | undefined
}) {
  return (
    <div className="fieldview">
      <a className="skip-link" href="#signin">
        Skip to the sign-in form
      </a>

      <header className="topbar">
        <span className="topbar__title">Deliveries</span>
      </header>

      <main className="fieldview__main" id="signin">
        <div className="page-head">
          <div className="grow">
            <h1>Sign in</h1>
            <p>Use the phone number your clinic has for you.</p>
          </div>
        </div>

        {error ? (
          /* role="alert" comes from Notice's `bad` tone. This arrives after a navigation
             the rider started, and a screen reader should hear why they are back here. */
          <Notice tone="bad" icon="lock">
            {error}
          </Notice>
        ) : null}

        <form action={submitSignIn} className="auth__fields">
          <Field
            name="phone"
            label="Phone number"
            hint="The number the clinic registered you with."
          >
            {(control) => (
              <Input
                {...control}
                type="tel"
                inputMode="tel"
                /* `username` as well as `tel`: password managers key their entry off the
                   username field, and a rider who saves their details once should not be
                   typing a number at the roadside every morning. */
                autoComplete="username tel"
                required
                autoFocus
              />
            )}
          </Field>

          <Field name="password" label="Password">
            {(control) => (
              <Input {...control} type="password" autoComplete="current-password" required />
            )}
          </Field>
          {/* No composition hint anywhere near this. A rule stated here tells anybody
              guessing what shape to guess, and this form has no idea what the password
              was set to. */}

          {/* `lg` and `block`: 52px tall and full width. This is the one target on the
              screen and it is pressed with a thumb, often with the other hand on a
              handlebar. `btn-sm` does not exist in the toolkit for the same reason. */}
          <Button type="submit" variant="primary" size="lg" block>
            <Icon name="lock" />
            Sign in
          </Button>
        </form>

        <p className="auth__aside">
          Trouble signing in? Ask your clinic — the dispatcher who assigns your deliveries
          can reset your details. Nobody at the clinic can see your password.
        </p>
      </main>
    </div>
  )
}

/**
 * The submission.
 *
 * REDIRECTS ON BOTH OUTCOMES, and that is what makes the screen safe to reload. A rider
 * whose signal dropped mid-submission will pull the page down to refresh it; if the
 * failure had been rendered from the POST's own response, that refresh would re-post the
 * password. Every path here ends in a GET.
 */
async function submitSignIn(formData: FormData) {
  'use server'

  const { redirect } = await import('next/navigation')

  const phone = String(formData.get('phone') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const result = await signInWithPassword(phone, password)

  if (!result.ok) {
    /*
     * THE API'S OWN SENTENCE, UNCHANGED. It answers "no account for that number" and
     * "wrong password" with the identical status and the identical body, so that nobody
     * can discover who rides for a named clinic by typing numbers at this form. A "check
     * your number" refinement here would reopen exactly that hole, which is why nothing
     * below branches on the field or the status.
     */
    redirect(
      `/sign-in?error=${encodeURIComponent(result.message ?? 'Those details did not work.')}`,
    )
  }

  redirect('/assignments')
}
