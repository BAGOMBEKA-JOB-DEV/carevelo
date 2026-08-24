import { redirect } from 'next/navigation'
import { Button, Card, Field, Input, Notice, PageHeader, Stack } from '@carevelo/ui'
import { completeChallenge, signInWithPassword } from '../api/signIn'
import type { IdentityPaths, SignInProblem, SignInStep } from '../model/signIn'

/**
 * Signing a Carevelo platform operator in: a password, then a code.
 *
 * ============================================================
 * WHAT THIS REPLACES, AND WHY THE ARGUMENT IT REPLACES STILL STANDS
 * ============================================================
 *
 * This screen replaces the guest half of `AccessNotice`, which said in the product that a
 * platform operator could not obtain a session on any host and that a password-only form
 * built here would authenticate the highest-privilege session in the product — the one that
 * can authorise a break-glass grant into a clinic's records — while looking compliant.
 *
 * That argument was right and it is worth restating rather than deleting, because it is the
 * bar this screen has to clear. It has not been softened; the API has changed underneath
 * it. Both of the gaps it named are now closed:
 *
 *   1. TOTP IS ENFORCED, NOT OFFERED. `POST /v1/platform/auth/sign-in` proves a password
 *      and calls no guard at all. There is no session until `POST
 *      /v1/platform/auth/challenge` accepts a code, and `RequireSecondFactor` guards every
 *      route in the platform group as a second lock on the same door. So the form below
 *      CANNOT authenticate anyone with one factor, however it is driven.
 *
 *   2. A PLATFORM SESSION HAS A STATED BINDING: none. A platform account has `tenant_id =
 *      null`, the sign-in route runs outside `ResolveTenant` and `BindTenantContext`, and
 *      nothing about it resolves or binds a clinic. That is why it can be reached from
 *      `admin.carevelo.app`, which is a host that deliberately resolves to no tenant.
 *
 * ============================================================
 * TWO SCREENS, NOT ONE FORM
 * ============================================================
 *
 * A combined form has to tell the person which half failed, and "the password is right,
 * the code is not" is worth a great deal to somebody working through a credential-stuffing
 * list. The API is built the same way, so the split here matches the contract rather than
 * decorating it. See model/signIn.ts.
 *
 * ============================================================
 * NO CLIENT JAVASCRIPT, AS EVERYWHERE ELSE ON THIS SURFACE
 * ============================================================
 *
 * Both forms post natively to Server Actions. Which step is showing travels in the URL as
 * `?step=code`, which is a hint about which form to draw and carries no authority: the
 * pending challenge is server-side state behind an HTTP-only cookie, and typing the
 * parameter by hand produces a code form whose code is refused.
 *
 * WHAT NEVER TRAVELS IN THE URL: the address, the password, and the code. The provisioning
 * form pays the same cost for a clinic's contact details and says so; here it is not a
 * matter of taste. A password or a live code in a query string is written into every access
 * log, proxy log and browser history entry between this server and the operator's screen.
 * So a refused form comes back empty, and the notice says so rather than leaving an
 * operator to conclude it is broken.
 *
 * @see docs/40-api/authentication-and-sessions.md § Second factor
 * @see docs/50-security-compliance/threat-model.md § Spoofing
 */
export type SignInScreenProps = {
  paths: IdentityPaths
  /** Which form to draw, from `?step=`. */
  step: SignInStep
  /** What the last attempt did, from `?problem=`. */
  problem?: SignInProblem | undefined
  /** The API's own sentence for it, from `?message=`. */
  message?: string | undefined
}

export function SignInScreen({ paths, step, problem, message }: SignInScreenProps) {
  async function submitPassword(formData: FormData) {
    'use server'

    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')

    /*
     * Presence only. Whether the address belongs to a platform account, and whether the
     * password is right, are the API's to decide — and it answers both with one
     * enumeration-safe sentence, deliberately. A second opinion here would be a rule free
     * to disagree with the real one, and on this form it would be a rule that told a
     * caller something the API refuses to.
     */
    if (email === '' || password === '') {
      return redirect(signInHref(paths.signIn, { problem: 'rejected' }))
    }

    const outcome = await signInWithPassword(email, password)

    if (outcome.kind === 'problem') {
      return redirect(signInHref(paths.signIn, { problem: outcome.problem, message: outcome.message }))
    }

    // The password was right. There is still no session — this is the second half of the
    // sign-in beginning, not a partly-open door.
    return redirect(signInHref(paths.signIn, { step: 'code' }))
  }

  async function submitCode(formData: FormData) {
    'use server'

    const code = String(formData.get('code') ?? '').trim()
    const recovery = String(formData.get('recovery_code') ?? '').trim()

    if (code === '' && recovery === '') {
      return redirect(signInHref(paths.signIn, { step: 'code', problem: 'code_rejected' }))
    }

    /*
     * ONE CREDENTIAL, NEVER BOTH. The API refuses a request carrying a code and a recovery
     * code together rather than applying a precedence rule, because a precedence rule on a
     * credential check is a way of choosing which of two comparisons an attacker gets to
     * skip. This form has two inputs, so the choice has to be made somewhere: the
     * authenticator code wins because it is the ordinary case, and an operator who filled
     * in both is told nothing about the one that was ignored.
     */
    const outcome = code !== ''
      ? await completeChallenge(code, 'code')
      : await completeChallenge(recovery, 'recovery_code')

    if (outcome.kind === 'problem') {
      const back = outcome.problem === 'expired' || outcome.problem === 'rejected'
        ? { problem: outcome.problem, message: outcome.message }
        : { step: 'code' as const, problem: outcome.problem, message: outcome.message }

      return redirect(signInHref(paths.signIn, back))
    }

    return redirect(paths.afterSignIn)
  }

  return (
    <>
      <PageHeader
        title={step === 'code' ? 'Enter your code' : 'Sign in'}
        description={
          step === 'code'
            ? 'Your password was accepted and you are not signed in yet. A code from your '
              + 'authenticator is the second half.'
            : 'Carevelo platform operators sign in with an email address and a password, '
              + 'and then a code from an authenticator app.'
        }
      />

      <Stack gap="6">
        {problem === 'rejected' ? (
          <Notice tone="warn" icon="lock" title="Those details do not match">
            {message
              ?? 'Those details do not match a Carevelo platform account. The answer is the '
                + 'same whether the address is unknown or the password is wrong.'}
          </Notice>
        ) : null}

        {problem === 'code_rejected' ? (
          <Notice tone="warn" icon="lock" title="That code is not right">
            {message ?? 'Try the code your authenticator is showing now.'}
          </Notice>
        ) : null}

        {problem === 'not_enrolled' ? (
          <Notice tone="warn" icon="lock" title="This account has no second factor">
            {message
              ?? 'A platform operator signs in with a password and then a code. This account '
                + 'has no authenticator enrolled.'}{' '}
            Enrolment is an out-of-band administrative act, not something this screen can
            start — ask an existing platform administrator.
          </Notice>
        ) : null}

        {problem === 'expired' ? (
          <Notice tone="info" icon="clock" title="That sign-in expired">
            {message ?? 'A code is expected within a few minutes of the password.'} Start
            again below.
          </Notice>
        ) : null}

        {problem === 'throttled' ? (
          <Notice tone="warn" title="Too many attempts">
            {message ?? 'Wait a few minutes and try again.'} The limit on codes is
            deliberately the tightest in the product: six digits is one in a million, and
            the limit is what makes that number mean something.
          </Notice>
        ) : null}

        {problem === 'failed' ? (
          <Notice tone="bad" title="That did not complete">
            {message
              ?? 'The request did not reach the API, and there is nothing this screen can '
                + 'pass on about why. You are not signed in.'}
          </Notice>
        ) : null}

        {step === 'code' ? (
          <Card as="section">
            <form action={submitCode}>
              <Stack gap="7">
                <Field
                  name="code"
                  label="Code from your authenticator"
                  hint="Six digits. It changes every thirty seconds, and the one showing now is the one to use."
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      // The browser must not keep a live second factor.
                      spellCheck={false}
                      maxLength={6}
                      autoFocus
                    />
                  )}
                </Field>

                <Field
                  name="recovery_code"
                  label="Or a recovery code"
                  hint={
                    'One of the codes you were shown when you enrolled. Each works once and '
                    + 'is gone afterwards. Use one only if your authenticator is not to hand.'
                  }
                >
                  {(control) => (
                    <Input {...control} type="text" autoComplete="off" spellCheck={false} />
                  )}
                </Field>

                <Stack gap="4">
                  <Button type="submit">Sign in</Button>
                  <Button variant="quiet" href={paths.signIn}>
                    Start again
                  </Button>
                </Stack>
              </Stack>
            </form>
          </Card>
        ) : (
          <Card as="section">
            <form action={submitPassword}>
              <Stack gap="7">
                <Field name="email" label="Email address">
                  {(control) => (
                    <Input
                      {...control}
                      type="email"
                      required
                      autoComplete="username"
                      spellCheck={false}
                      autoFocus
                    />
                  )}
                </Field>

                <Field name="password" label="Password">
                  {(control) => (
                    <Input {...control} type="password" required autoComplete="current-password" />
                  )}
                </Field>

                <Button type="submit">Continue</Button>
              </Stack>
            </form>
          </Card>
        )}

        <Card as="section">
          <Stack gap="4">
            <h2>Why there are two steps</h2>
            <p className="muted">
              A single form taking a password and a code has to say which half was wrong, and
              &ldquo;the password is right, the code is not&rdquo; is worth a great deal to
              somebody working through a list of stolen passwords. The API is built the same
              way: proving the password opens no session at all, and the code is the request
              that signs you in.
            </p>
            <p className="muted">
              The second factor is an authenticator app and your recovery codes. There is no
              &ldquo;send me a code&rdquo; option and there will not be one — a code that
              arrives by SMS is one SIM swap away from being no second factor, and this is
              the account that can authorise access to a clinic&rsquo;s patient records.
            </p>
            <p className="muted">
              Nothing you type here is kept if the sign-in is refused. A password or a live
              code carried back through a URL would be written into every log between this
              server and your browser.
            </p>
          </Stack>
        </Card>
      </Stack>
    </>
  )
}

/**
 * The URL to come back to.
 *
 * `URLSearchParams` rather than a template string, because `message` is a sentence from the
 * API and a `&` inside one silently truncates the next parameter. The base always comes
 * from `IdentityPaths`, which the route layer owns: an action must never take its
 * destination from the request, and passing every destination in from the route is what
 * makes that structurally impossible rather than a thing each action remembers.
 */
function signInHref(
  base: string,
  params: { step?: SignInStep; problem?: SignInProblem; message?: string },
): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value))
    }
  }

  const query = search.toString()

  return query === '' ? base : `${base}?${query}`
}
