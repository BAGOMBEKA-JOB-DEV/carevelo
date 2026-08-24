import { redirect } from 'next/navigation'
import { Badge, Button, Card, Choice, DateTime, Field, Input, Notice, Stack } from '@carevelo/ui'
import { attempt, writeFailure } from '../api/http'
import {
  getAggregatorAccount,
  saveAggregatorCredentials,
  verifyAggregatorAccount,
} from '../api/aggregator'
import type {
  AggregatorEnvironment,
  AggregatorProvider,
  TenantPaths,
} from '../model/types'
import { AccessNotice } from './AccessNotice'
import {
  NON_CUSTODIAL,
  aggregatorStatusLabel,
  aggregatorTone,
  first,
  samePath,
  text,
  trimmed,
  withParams,
  type SearchValue,
} from './screen'

/**
 * Connecting the clinic's OWN mobile-money account.
 *
 * ------------------------------------------------------------------------------
 * THE SENTENCE IS THE SCREEN.
 *
 * §H1.5: "the UI should say plainly what it means: money goes from your patient to your
 * account. Carevelo never holds it and cannot access it." It is a sales asset as much as a
 * compliance statement — a clinic owner is rightly suspicious of software that touches
 * their money — and it is true in the strongest available sense: there IS no platform
 * merchant account. Carevelo has none and will never have one, because custody would put
 * it inside the NPS Act 2020 PSP or e-money categories and their UGX 250m–10bn capital
 * requirements.
 *
 * So the sentence goes above the form, not below it, and it is imported from one place.
 *
 * ------------------------------------------------------------------------------
 * NOTHING ON THIS SCREEN READS A CREDENTIAL BACK, AND NOTHING CAN.
 *
 * `AggregatorAccountResource` enumerates four facts and no secret; `credentials_are_write_only`
 * is `true` on every response; `AggregatorAccountPolicy::viewSecrets()` returns false for
 * every role including a platform operator holding a break-glass grant. Acceptance criterion
 * 3 covers it with an automated test: credentials never appear in any API response, log line
 * or exception trace.
 *
 * The consequence for the form: every box opens EMPTY and every save is a REPLACEMENT of
 * the whole credential set. There is no masked value, no "reveal" toggle, and no field
 * showing the last four characters of anything — there is nothing to fill them with, and
 * building the control would build the expectation. The screen says this in as many words,
 * because an administrator who cannot see what is stored will otherwise assume the screen
 * is broken.
 *
 * ------------------------------------------------------------------------------
 * A REFUSED CREDENTIAL DOES NOT BLOCK ONBOARDING, AND THE AGGREGATOR'S OWN WORDS ARE SHOWN.
 *
 * §H1's exception table: "Show the aggregator's own error verbatim; keep
 * `pending_verification`; do not block other onboarding." Only the aggregator knows why a
 * key was refused — an expired key, a wrong environment, an account not yet approved for
 * collections are three different things needing three different actions — and paraphrasing
 * loses the half the administrator can act on.
 *
 * And §H1.6: a clinic with NO account at all completes onboarding, runs consultations and
 * takes payment at the counter. `unconfigured` is a working state; this screen presents it
 * as a choice the clinic has made rather than a step it has failed.
 */

export type PaymentConnectionScreenProps = {
  paths: TenantPaths
  saved?: SearchValue
  problem?: SearchValue
  /** The aggregator's own words from a failed verification. Never paraphrased. */
  aggregatorMessage?: SearchValue
}

/** Only Flutterwave is implemented; Pesapal is accepted so a clinic can record what it holds. */
const PROVIDERS: readonly { value: AggregatorProvider; label: string; note: string }[] = [
  {
    value: 'flutterwave',
    label: 'Flutterwave',
    note: 'Fully supported. Collections and status checks both work.',
  },
  {
    value: 'pesapal',
    label: 'Pesapal',
    note: 'Recorded, but verification will refuse it until Carevelo\'s Pesapal client exists. That is a truthful answer rather than a silent one.',
  },
]

const ENVIRONMENTS: readonly { value: AggregatorEnvironment; label: string; note: string }[] = [
  {
    value: 'sandbox',
    label: 'Sandbox',
    note: 'The aggregator\'s test environment. No real money moves. Start here.',
  },
  {
    value: 'live',
    label: 'Live',
    note: 'Real collections from real patients into this clinic\'s real account.',
  },
]

export async function PaymentConnectionScreen(props: PaymentConnectionScreenProps) {
  const { paths } = props
  const saved = first(props.saved)
  const problem = first(props.problem)
  const aggregatorMessage = first(props.aggregatorMessage)

  const result = await attempt(getAggregatorAccount())

  if (!result.ok) {
    return <AccessNotice failure={result} context="this clinic's payment connection" />
  }

  const account = result.value
  const connected = account.status !== 'unconfigured'

  return (
    <div className="grid">
      {problem === undefined ? null : (
        <Notice tone="bad" title="That was not saved" announce>
          {problem}
        </Notice>
      )}

      {saved === undefined ? null : <Notice tone="info">{saved}</Notice>}

      {/*
       * THE AGGREGATOR'S OWN WORDS, VERBATIM, IN THEIR OWN BOX.
       *
       * Separated from `problem` on purpose: this is not Carevelo refusing something, it is
       * a third party reporting on a credential. Presenting the two identically would let
       * an administrator read "invalid API key" as a Carevelo bug and open a support ticket
       * with the wrong company.
       */}
      {aggregatorMessage === undefined ? null : (
        <Notice tone="warn" title="Your aggregator refused the credentials" announce>
          <p className="mono">{aggregatorMessage}</p>
          <p className="fine">
            That message is from your aggregator, word for word — Carevelo has not
            interpreted it. Nothing else about this clinic is blocked: appointments and
            dispensing continue on pay-at-clinic while this is sorted out.
          </p>
        </Notice>
      )}

      <Card as="section">
        <span className="eyebrow">Where the money goes</span>
        <h2 className="title-sm">{NON_CUSTODIAL}</h2>
        <p className="muted">
          A patient pays your merchant account at a Bank of Uganda licensed aggregator, using
          your own credentials. Carevelo has no merchant account of its own — not for this
          clinic, not for any clinic — so there is no account for your patients&rsquo; money
          to pass through and nothing for Carevelo to hold, delay or deduct from.
        </p>
        <p className="fine">
          Carevelo charges the clinic a subscription. It never takes a percentage of a
          consultation fee, because it is never in a position to.
        </p>
      </Card>

      <Card as="section">
        <div className="row between">
          <div className="grow">
            <span className="eyebrow">Connection</span>
            <h2 className="title-sm">{aggregatorStatusLabel(account.status)}</h2>
          </div>
          <Badge tone={aggregatorTone(account)}>
            {account.accepts_online_payment ? 'Taking payments online' : 'Pay at the clinic'}
          </Badge>
        </div>

        {connected ? (
          <dl className="grid g-3" style={{ marginTop: 'var(--space-5)' }}>
            <div className="stat">
              <dt className="stat__label">Aggregator</dt>
              <dd className="stat__note">{account.provider}</dd>
            </div>
            <div className="stat">
              <dt className="stat__label">Environment</dt>
              <dd className="stat__note">{account.environment}</dd>
            </div>
            <div className="stat">
              <dt className="stat__label">Last verified</dt>
              <dd className="stat__note">
                {account.last_verified_at === null ? (
                  'Never'
                ) : (
                  <DateTime value={account.last_verified_at} format="datetime" />
                )}
              </dd>
            </div>
          </dl>
        ) : null}

        {/*
         * The API's own fallback sentence, verbatim. It is on every response for exactly
         * this reason: without it a console renders a missing payment account as a blocking
         * error, and a clinic stops booking patients over a feature it has chosen not to
         * use.
         */}
        <Notice tone="info" icon="shield">
          <p>{account.fallback}</p>
          {connected ? null : (
            <p className="fine">
              Plenty of clinics run this way permanently. If you would rather take mobile
              money online, you need an account of your own with Flutterwave or Pesapal
              first — Carevelo cannot open one for you, and would not be allowed to.
            </p>
          )}
        </Notice>

        {connected ? (
          <form
            action={runVerification.bind(null, { selfPath: paths.payments })}
            style={{ marginTop: 'var(--space-5)' }}
          >
            <Button type="submit" variant="primary">
              Check these credentials now
            </Button>
            <p className="fine" style={{ marginTop: 'var(--space-2)' }}>
              This asks your aggregator about a reference that does not exist. It moves no
              money and charges nobody — testing a key with a real collection would mean
              charging somebody to prove a configuration.
            </p>
          </form>
        ) : null}
      </Card>

      <Card as="section">
        <Stack gap="6">
          <Stack gap="none">
            <span className="eyebrow">Credentials</span>
            <h2 className="title-sm">
              {connected ? 'Replace the stored credentials' : 'Connect your merchant account'}
            </h2>
          </Stack>

          <Notice tone="info" title="These boxes always open empty" icon="lock">
            <p>
              Credentials are write-only. Once stored they are never returned by anything —
              not to you, not to Carevelo, not to a Carevelo operator with an emergency access
              grant, and not into a log line. There is nothing here to show you and no way to
              build a control that would.
            </p>
            <p className="fine">
              That means saving replaces the whole set at once. Have the secret key to hand
              before you start: a half-rotated key pair fails at the aggregator hours later,
              in production, on a live collection.
            </p>
          </Notice>

          <form action={saveCredentials.bind(null, { selfPath: paths.payments })}>
            <Stack gap="6">
              <Choice
                name="provider"
                id="aggregator-provider"
                legend="Your aggregator"
                required
                options={PROVIDERS.map((provider) => ({
                  value: provider.value,
                  label: provider.label,
                  note: provider.note,
                }))}
                defaultValue={connected ? account.provider : 'flutterwave'}
              />

              <Choice
                name="environment"
                id="aggregator-environment"
                legend="Which of their environments"
                required
                options={ENVIRONMENTS.map((environment) => ({
                  value: environment.value,
                  label: environment.label,
                  note: environment.note,
                }))}
                defaultValue={connected ? account.environment : 'sandbox'}
              />

              <Field
                name="secret_key"
                label="Secret key"
                hint="From your own aggregator dashboard. Required — it is what actually authorises a collection."
              >
                {/*
                 * type="password" so it is not readable over a shoulder at a busy front desk,
                 * and autoComplete="off" so no browser or password manager keeps a copy of a
                 * merchant credential in a profile that syncs.
                 */}
                {(control) => (
                  <Input {...control} type="password" autoComplete="off" minLength={8} maxLength={255} required />
                )}
              </Field>

              <Field name="public_key" label="Public key" hint="Optional, depending on your aggregator.">
                {(control) => (
                  <Input {...control} type="password" autoComplete="off" maxLength={255} />
                )}
              </Field>

              <Field
                name="webhook_secret"
                label="Webhook secret"
                hint="How Carevelo proves an incoming payment notification really came from your aggregator. Without it, notifications from them cannot be trusted and are ignored."
              >
                {(control) => (
                  <Input {...control} type="password" autoComplete="off" maxLength={255} />
                )}
              </Field>

              <Field
                name="merchant_reference"
                label="Your merchant reference"
                hint="Optional. Your own reference at the aggregator, so you can match a collection to a line on their dashboard unaided."
              >
                {(control) => <Input {...control} type="text" autoComplete="off" maxLength={64} />}
              </Field>

              <div className="row-wrap">
                <Button type="submit" variant="primary">
                  Save and verify
                </Button>
                <span className="fine">
                  Saving marks the connection unverified until it has been checked — even if only
                  the webhook secret changed.
                </span>
              </div>

            </Stack>
          </form>
        </Stack>
</Card>
    </div>
  )
}

type PaymentContext = { selfPath: string }

/**
 * Store the credentials, then immediately check them.
 *
 * ONE BUTTON FOR BOTH, because they are one intention. `PUT` drops the status to
 * `pending_verification` on every write — the backend refusing to let an untested credential
 * claim to be active — so a screen that saved and stopped would leave every clinic sitting
 * at "awaiting verification" wondering what else was expected of them.
 *
 * THE VERIFICATION FAILING IS NOT THE SAVE FAILING, and the two report differently. The
 * credentials are stored either way, onboarding continues either way, and the aggregator's
 * own sentence travels back on its own parameter so the screen can attribute it correctly.
 */
async function saveCredentials(context: PaymentContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')

  const provider = text(formData, 'provider')
  const environment = text(formData, 'environment')

  /*
   * Checked against the offered lists before anything is sent. A form field is a value from
   * the far side of the wire, and while the API validates both against its own lists too,
   * refusing here keeps this screen from claiming to support an aggregator it does not.
   */
  if (!isProvider(provider) || !isEnvironment(environment)) {
    redirect(
      withParams(back, {
        problem: 'Choose an aggregator and one of its environments.',
        saved: null,
        aggregator: null,
      }),
    )
  }

  let failure: string | null = null

  try {
    await saveAggregatorCredentials({
      provider,
      environment,
      secret_key: text(formData, 'secret_key') ?? '',
      public_key: trimmed(formData, 'public_key'),
      webhook_secret: trimmed(formData, 'webhook_secret'),
      merchant_reference: trimmed(formData, 'merchant_reference'),
    })
  } catch (error) {
    failure = writeFailure(error, 'saving the aggregator credentials')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null, aggregator: null }))
  }

  await verifyAndReturn(back, 'Credentials saved.')
}

/** Re-check what is already stored, without changing it. */
async function runVerification(context: PaymentContext, _formData: FormData): Promise<void> {
  'use server'

  await verifyAndReturn(samePath(context.selfPath, '/'), '')
}

/**
 * Run the check and go back with whatever it had to say.
 *
 * A REFUSAL IS A 200 carrying `meta.verification_message`, so the ordinary failure path is
 * not an exception at all. The one case that DOES throw is verifying with nothing stored —
 * a 409 whose sentence says so — and it lands in `problem` rather than in the aggregator
 * box, because it is Carevelo speaking and not the aggregator.
 */
async function verifyAndReturn(back: string, prefix: string): Promise<void> {
  let message: string | null = null
  let accepted = false
  let failure: string | null = null

  try {
    const outcome = await verifyAggregatorAccount()
    message = outcome.message
    accepted = outcome.account.accepts_online_payment
  } catch (error) {
    failure = writeFailure(error, 'verifying the aggregator credentials')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null, aggregator: null }))
  }

  if (message !== null) {
    redirect(
      withParams(back, {
        aggregator: message,
        saved: prefix === '' ? null : `${prefix} They have not been accepted yet.`,
        problem: null,
      }),
    )
  }

  redirect(
    withParams(back, {
      saved: `${prefix} Your aggregator accepted these credentials.${
        accepted ? ' This clinic can now take mobile money online.' : ''
      }`.trim(),
      problem: null,
      aggregator: null,
    }),
  )
}

function isProvider(value: string | null): value is AggregatorProvider {
  return PROVIDERS.some((provider) => provider.value === value)
}

function isEnvironment(value: string | null): value is AggregatorEnvironment {
  return ENVIRONMENTS.some((environment) => environment.value === value)
}
