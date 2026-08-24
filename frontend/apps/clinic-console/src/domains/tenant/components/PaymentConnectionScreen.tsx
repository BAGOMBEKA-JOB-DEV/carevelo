import { redirect } from 'next/navigation'
import {
  Badge,
  Button,
  Card,
  Choice,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  Inline,
  Input,
  Notice,
  Stack,
} from '@carevelo/ui'
import { attempt, writeFailure } from '../api/http'
import {
  getAggregatorAccount,
  saveAggregatorCredentials,
  verifyAggregatorAccount,
} from '../api/aggregator'
import {
  AGGREGATOR_PROFILES,
  aggregatorProfile,
  ipnRegistration,
  selectedProfile,
  type AggregatorProfile,
  type IpnRegistration,
} from '../model/aggregator'
import type { AggregatorEnvironment, TenantPaths } from '../model/types'
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
 * Connecting the clinic's OWN merchant account.
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
 * A SECOND AGGREGATOR DOES NOT WEAKEN THAT, AND THIS SCREEN IS WHERE IT IS SHOWN NOT TO.
 * Pesapal is one merchant account per clinic, exactly as Flutterwave is, so the money still
 * goes patient → aggregator → that clinic's own account and there is still no place in the
 * path where Carevelo could hold it even if it wanted to. The sentence above the form is
 * unchanged because nothing it says has changed.
 *
 * ------------------------------------------------------------------------------
 * THE TWO AGGREGATORS ASK FOR DIFFERENT THINGS, AND THE SCREEN DRESSES ITSELF FOR ONE.
 *
 * Flutterwave asks for a secret key and, optionally, a public key. Pesapal asks for a
 * consumer key and a consumer secret, both of them secret and both of them required, which
 * `PesapalClient::credentials()` reads out of `public_key` and `secret_key` respectively.
 * Labelling Pesapal's consumer key "Public key" would be telling a clinic administrator to
 * find something their aggregator has never issued.
 *
 * So the provider is chosen FIRST, as a navigation, and the rest of the panel — labels,
 * hints, where to find the credentials, what verification will do — comes from
 * `model/aggregator.ts` for whichever one is selected.
 *
 * WHY A LINK AND NOT A RADIO, when the radio was already here and already posted natively.
 * A radio cannot change a label without a client boundary and a state hook, and these forms
 * must post with JavaScript switched off entirely — a clinic administrator on a stalled
 * connection is the ordinary case here, not the degraded one. A link re-renders the panel
 * on the server with the right words in it and costs no bundle at all. The cost is that
 * choosing an aggregator reloads the panel, which is why the choice sits ABOVE the boxes
 * rather than among them: by the time anything has been typed, the choice is already made.
 *
 * ------------------------------------------------------------------------------
 * NOTHING ON THIS SCREEN READS A CREDENTIAL BACK, AND NOTHING CAN.
 *
 * `AggregatorAccountResource` enumerates its fields and no secret; `credentials_are_write_only`
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
  /**
   * Which aggregator to dress the panel for, from `?provider=`.
   *
   * Not a setting and not stored anywhere — it decides what words this render uses and
   * nothing else. An unrecognised value falls back to the connected provider rather than
   * throwing, because it arrives in a search parameter and anybody can type one.
   */
  provider?: SearchValue
  saved?: SearchValue
  problem?: SearchValue
  /** The aggregator's own words from a failed verification. Never paraphrased. */
  aggregatorMessage?: SearchValue
}

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

/** The id the empty state's button jumps to, so the two cannot drift apart. */
const CREDENTIALS_ANCHOR = 'aggregator-credentials'

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
  const profile = selectedProfile(first(props.provider), account)

  /* The words for the account that EXISTS, which is not always the one being edited: an
     administrator can be reading Pesapal's requirements while still connected to
     Flutterwave. The status card must describe what is stored, never what is selected. */
  const connectedProfile = connected ? aggregatorProfile(account.provider) : null

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
          That is true of both aggregators below. Each clinic connects one merchant account
          of its own, and Carevelo charges the clinic a subscription — it never takes a
          percentage of a consultation fee, because it is never in a position to.
        </p>
      </Card>

      <Card as="section">
        {/* One column for the card, and the two hand-set `marginTop`s become its gap. */}
        <Stack gap="5">
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
            /*
              The `marginTop` is gone into the Stack above; the classes stay. `<dl>` does not
              become a `<Grid>` because Grid's element union stops at the elements that are
              layout, and a description list is a promise to a screen reader about what its
              children are: term, definition, term, definition. `.grid g-3` is the same
              three-column collapse `<Grid cols={3}>` would render, and the token layer
              already owns it — there is nothing left here to move.
            */
            <dl className="grid g-3">
              <div className="stat">
                <dt className="stat__label">Aggregator</dt>
                <dd className="stat__note">{connectedProfile?.label ?? account.provider}</dd>
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
          ) : (
            /*
             * NOT A BLANK PANEL AND NOT AN ERROR.
             *
             * `EmptyState` and not `<Notice tone="bad">`, because the read succeeded and the
             * answer is "there is no account here" — which §H1.6 makes a working state. What
             * it has to carry is the bit an administrator cannot guess: Carevelo cannot open
             * a merchant account on a clinic's behalf and would not be allowed to, so the
             * first move is at the aggregator and not on this screen.
             */
            <EmptyState
              icon="lock"
              title="No merchant account is connected"
              action={
                <Button href={`#${CREDENTIALS_ANCHOR}`} variant="primary">
                  Connect an account
                </Button>
              }
            >
              This clinic takes payment at the counter, and plenty of clinics run that way
              permanently. To take mobile money online you need an account of your own with
              Flutterwave or Pesapal first — open one with them, then bring the credentials
              back here. Carevelo cannot open one for you and would not be permitted to.
            </EmptyState>
          )}

          {connectedProfile?.registersNotificationUrl === true ? (
            <NotificationUrlState state={ipnRegistration(account)} />
          ) : null}

          {/*
           * The API's own fallback sentence, verbatim. It is on every response for exactly
           * this reason: without it a console renders a missing payment account as a blocking
           * error, and a clinic stops booking patients over a feature it has chosen not to
           * use.
           */}
          <Notice tone="info" icon="shield">
            <p>{account.fallback}</p>
          </Notice>

          {connected ? (
            <form
              action={runVerification.bind(null, {
                selfPath: paths.payments,
                provider: profile.value,
              })}
            >
              {/* The button keeps a block wrapper so it stays its own width rather than
                  stretching to the column, which is what a Stack child does by default. */}
              <Stack gap="2">
                <div>
                  <Button type="submit" variant="primary">
                    Check these credentials now
                  </Button>
                </div>
                <p className="fine">
                  {connectedProfile?.verification
                    ?? 'This asks your aggregator about a reference that does not exist.'}{' '}
                  It moves no money and charges nobody — testing a key with a real collection
                  would mean charging somebody to prove a configuration.
                </p>
              </Stack>
            </form>
          ) : null}
        </Stack>
      </Card>

      <Card as="section">
        <Stack gap="5">
          <Stack gap="none">
            <span className="eyebrow">Choosing between them</span>
            <h2 className="title-sm">What each aggregator asks of you</h2>
          </Stack>

          {/*
           * A TABLE BECAUSE THERE IS A COLUMN TO COMPARE DOWN, which is the test
           * `components.css` sets beside `.kv` for when a `<dl>` is the wrong shape. An
           * administrator reading this is deciding between two aggregators, and the whole
           * question is what differs between them.
           *
           * DELIBERATELY NOT `className="queue"`. Rule 8 in console.css bounds the height of
           * the long lists — the pharmacy queue, the dispatch board, the registry — so their
           * headings have something to stick to. It says in its own words that the short
           * tables are left alone, because a scroll region over five rows is furniture with
           * nothing to hold. This is five rows. `.card.panel-table` is likewise absent: this
           * card holds a heading and a table, so the 24px of padding is doing its ordinary
           * job rather than framing a table that already has its own.
           */}
          <DataTable
            caption="What Flutterwave and Pesapal each ask a clinic for, and what each does afterwards."
            captionHidden
            rows={COMPARISON}
            rowKey={(row) => row.key}
            empty={
              <EmptyState icon="lock" title="No aggregators are offered">
                Carevelo has no aggregator client at all, which should be impossible on this
                screen. Report it rather than working around it.
              </EmptyState>
            }
            columns={[
              {
                key: 'aspect',
                header: 'What differs',
                rowHeader: true,
                cell: (row) => row.aspect,
              },
              ...AGGREGATOR_PROFILES.map((candidate) => ({
                key: candidate.value,
                header: candidate.label,
                cell: (row: ComparisonRow) => row.read(candidate),
              })),
            ]}
          />

          <p className="fine">
            Both hold Bank of Uganda Payment System Operator licences, and a clinic connects
            one account of its own with either. Carevelo talks to both.
          </p>
        </Stack>
      </Card>

      <Card as="section" id={CREDENTIALS_ANCHOR}>
        <Stack gap="6">
          <Stack gap="none">
            <span className="eyebrow">Credentials</span>
            <h2 className="title-sm">
              {connected ? 'Replace the stored credentials' : 'Connect your merchant account'}
            </h2>
          </Stack>

          {/*
           * STEP ONE, AND IT IS A NAVIGATION.
           *
           * `aria-current` rather than a colour alone, for the same reason every badge in
           * this product carries a word: a selected state expressed only as a darker button
           * is invisible to a screen reader and ambiguous to a colour-blind administrator.
           * `nav` gives the pair an accessible name, so it is announced as a choice rather
           * than as two loose links in the middle of a form.
           */}
          <Stack gap="3">
            <span className="stat__label" id="aggregator-choice">
              Which aggregator is this account with?
            </span>
            <nav aria-labelledby="aggregator-choice">
              <Inline gap="3">
                {AGGREGATOR_PROFILES.map((candidate) => {
                  const current = candidate.value === profile.value

                  return (
                    <Button
                      key={candidate.value}
                      href={withParams(paths.payments, {
                        provider: candidate.value,
                        saved: null,
                        problem: null,
                        aggregator: null,
                      })}
                      variant={current ? 'primary' : 'quiet'}
                      aria-current={current ? 'true' : undefined}
                    >
                      {candidate.label}
                      {current ? <span className="sr-only"> (selected)</span> : null}
                    </Button>
                  )
                })}
              </Inline>
            </nav>
            <p className="fine">
              Picking one reloads this panel with that aggregator&rsquo;s own words on it, so
              do it before you start typing — the boxes below always open empty.
            </p>
          </Stack>

          <Notice tone="info" title="These boxes always open empty" icon="lock">
            <p>
              Credentials are write-only. Once stored they are never returned by anything —
              not to you, not to Carevelo, not to a Carevelo operator with an emergency access
              grant, and not into a log line. There is nothing here to show you and no way to
              build a control that would.
            </p>
            <p className="fine">
              That means saving replaces the whole set at once. Have {profile.label}&rsquo;s
              credentials to hand before you start: a half-rotated pair fails at the
              aggregator hours later, in production, on a live collection.
            </p>
          </Notice>

          <form
            action={saveCredentials.bind(null, { selfPath: paths.payments, provider: profile.value })}
          >
            <Stack gap="6">
              {/*
               * The chosen aggregator travels with the post as well as in the URL, because
               * the URL is not what was submitted — an administrator can select Pesapal,
               * press back, and submit a form that was rendered for Flutterwave. The action
               * checks this value against the offered list before sending it anywhere, and
               * the API checks it again against its own.
               */}
              <input type="hidden" name="provider" value={profile.value} />

              <Choice
                name="environment"
                id="aggregator-environment"
                legend={`Which of ${profile.label}'s environments`}
                required
                options={ENVIRONMENTS.map((environment) => ({
                  value: environment.value,
                  label: environment.label,
                  note: environment.note,
                }))}
                defaultValue={
                  connected && account.provider === profile.value ? account.environment : 'sandbox'
                }
              />

              <Notice tone="neutral" icon="activity" title={`Where to find these at ${profile.label}`}>
                <p>{profile.whereToGet}</p>
              </Notice>

              <Field name="secret_key" label={profile.secretLabel} hint={profile.secretHint}>
                {/*
                 * type="password" so it is not readable over a shoulder at a busy front desk,
                 * and autoComplete="off" so no browser or password manager keeps a copy of a
                 * merchant credential in a profile that syncs.
                 */}
                {(control) => (
                  <Input {...control} type="password" autoComplete="off" minLength={8} maxLength={255} required />
                )}
              </Field>

              <Field name="public_key" label={profile.secondLabel} hint={profile.secondHint}>
                {/*
                 * `required` follows the aggregator, not the API. `public_key` is validated
                 * `sometimes|nullable` because Flutterwave genuinely does not need one — but
                 * a Pesapal account saved without its consumer key cannot request a token at
                 * all, and the clinic would be told its credentials were refused when in fact
                 * half of them were never entered. The Server Action refuses it as well:
                 * `required` on an input is a courtesy to the person typing, not a control.
                 */}
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    autoComplete="off"
                    maxLength={255}
                    required={profile.requiresSecondHalf}
                  />
                )}
              </Field>

              <Field
                name="webhook_secret"
                label="Webhook secret"
                hint={
                  profile.registersNotificationUrl
                    ? 'Optional for Pesapal, whose notification carries no signature to check — '
                      + 'Carevelo asks Pesapal what happened instead of trusting what it was sent.'
                    : 'How Carevelo proves an incoming payment notification really came from your '
                      + 'aggregator. Without it, notifications from them cannot be trusted and are ignored.'
                }
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

/* ============================================================================
   PESAPAL'S NOTIFICATION URL
   ============================================================================ */

/**
 * Whether Pesapal has anywhere to send this clinic's notifications.
 *
 * WHY THIS IS WORTH A PANEL RATHER THAN A LINE OF SMALL PRINT. Pesapal's inbound message
 * carries no status and no signature — that is its design, not a shortcoming — so all it
 * does is prompt Carevelo to go and ask. A clinic with no registered URL still takes
 * payment perfectly well and simply never gets the prompt, so an appointment sits
 * unconfirmed until the scheduled re-check catches up. Nothing is lost and nothing is
 * wrong, but it is slow in a way nobody would ever think to look for, and a failure nobody
 * looks for is the kind this screen exists to make visible.
 *
 * `not_reported` IS SHOWN AS ITSELF. The console will not claim a registration it cannot
 * see: `AggregatorAccountResource` publishes seven fields and none of them is this one, so
 * until it does, the honest answer is that Carevelo does not report it — and the sentence
 * beside it is the one that stays useful either way, because it says what happens when a
 * notification never arrives.
 */
function NotificationUrlState({ state }: { state: IpnRegistration }) {
  if (state === 'unregistered') {
    return (
      <Notice tone="warn" title="Pesapal has no notification URL for this account" announce>
        <p>
          Payments will still be taken. What will not happen is Pesapal telling Carevelo the
          moment one succeeds — so an appointment can sit unconfirmed until the scheduled
          re-check asks Pesapal directly, which is minutes rather than seconds.
        </p>
        <p className="fine">
          Carevelo registers the URL with your own credentials the first time it starts a
          collection, and re-uses it afterwards. If it stays unregistered, check the
          credentials above: a pair Pesapal will not issue a token for cannot register
          anything either.
        </p>
      </Notice>
    )
  }

  return (
    <Notice
      tone={state === 'registered' ? 'info' : 'neutral'}
      icon="activity"
      title={
        state === 'registered'
          ? 'Pesapal has a notification URL for this account'
          : 'How Carevelo hears from Pesapal'
      }
    >
      <p>
        Pesapal notifies Carevelo through a URL registered on your own account, which
        Carevelo registers with your credentials the first time it starts a collection. That
        notification carries no status and no signature by Pesapal&rsquo;s design, so it is
        treated as a prompt to ask Pesapal what actually happened rather than as an answer.
      </p>
      <p className="fine">
        {state === 'registered'
          ? 'A notification that never arrives is caught by the scheduled re-check, so a payment is never left unresolved on one channel alone.'
          : 'Carevelo does not yet report whether that registration exists. A notification that never arrives is caught by the scheduled re-check either way, so a payment is never left unresolved on one channel alone.'}
      </p>
    </Notice>
  )
}

/* ============================================================================
   THE COMPARISON
   ============================================================================ */

type ComparisonRow = {
  key: string
  aspect: string
  read: (profile: AggregatorProfile) => string
}

/**
 * The five things that actually differ, and nothing that does not.
 *
 * Each row READS the same property off whichever profile a column is for, so a column
 * cannot fall behind the panel below it: there is one set of sentences per aggregator and
 * both surfaces render it. Adding a third aggregator adds a column here with no edit at
 * all, which is the property that made this worth being data.
 */
const COMPARISON: readonly ComparisonRow[] = [
  {
    key: 'required',
    aspect: 'The credential it must have',
    read: (profile) => profile.secretLabel,
  },
  {
    key: 'second',
    aspect: 'The other half',
    read: (profile) =>
      profile.requiresSecondHalf
        ? `${profile.secondLabel} — required`
        : `${profile.secondLabel} — optional`,
  },
  {
    key: 'journey',
    aspect: 'How your patient pays',
    read: (profile) => profile.patientJourney,
  },
  {
    key: 'outcome',
    aspect: 'How Carevelo learns it worked',
    read: (profile) => profile.outcomeArrives,
  },
  {
    key: 'verification',
    aspect: 'What "check these credentials" does',
    read: (profile) => profile.verification,
  },
]

/* ============================================================================
   WRITES
   ============================================================================ */

/**
 * What a form on this screen posts back to, and which aggregator it was rendered for.
 *
 * Two plain strings and nothing callable. An inline Server Action's captured bindings are
 * serialised on every render, and an object carrying a function anywhere inside it cannot
 * be — see `src/serverActionClosures.test.ts`, which exists because that shipped in six
 * components at once. These are bound arguments rather than captures for the same reason
 * they always were: an encrypted bound argument cannot be edited in the page, and an open
 * redirect on a screen handling merchant credentials is a phishing kit with the clinic's
 * own name on it.
 */
type PaymentContext = { selfPath: string; provider: string }

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

  const submitted = text(formData, 'provider')
  const environment = text(formData, 'environment')

  /*
   * Checked against the offered list before anything is sent. A form field is a value from
   * the far side of the wire, and while the API validates both against its own lists too,
   * refusing here keeps this screen from claiming to support an aggregator it does not.
   */
  const profile = aggregatorProfile(submitted)

  /* The panel to come back to. The submitted provider where it is one, so a rejected save
     returns to the aggregator the administrator was actually filling in rather than to
     whichever one the URL still names. */
  const back = withParams(samePath(context.selfPath, '/'), {
    provider: profile?.value ?? aggregatorProfile(context.provider)?.value ?? null,
  })

  if (profile === null || !isEnvironment(environment)) {
    redirect(
      withParams(back, {
        problem: 'Choose an aggregator and one of its environments.',
        saved: null,
        aggregator: null,
      }),
    )
  }

  const secondHalf = trimmed(formData, 'public_key')

  /*
   * BOTH HALVES OR NEITHER, for an aggregator that issues them as a pair.
   *
   * `public_key` is `sometimes|nullable` at the API because Flutterwave does not need one,
   * so nothing downstream would refuse a Pesapal account with only a consumer secret. It
   * would be stored, the status would drop to pending, verification would fail, and the
   * clinic would read "your aggregator refused the credentials" — which is true and useless,
   * because Pesapal is refusing a request Carevelo could never have made.
   */
  if (profile.requiresSecondHalf && secondHalf === null) {
    redirect(
      withParams(back, {
        problem:
          `${profile.label} issues a ${profile.secondLabel.toLowerCase()} and a `
          + `${profile.secretLabel.toLowerCase()} as one pair, and needs both. Nothing has been `
          + 'saved — enter both boxes and try again.',
        saved: null,
        aggregator: null,
      }),
    )
  }

  let failure: string | null = null

  try {
    await saveAggregatorCredentials({
      provider: profile.value,
      environment,
      secret_key: text(formData, 'secret_key') ?? '',
      public_key: secondHalf,
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

  const back = withParams(samePath(context.selfPath, '/'), {
    provider: aggregatorProfile(context.provider)?.value ?? null,
  })

  await verifyAndReturn(back, '')
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

function isEnvironment(value: string | null): value is AggregatorEnvironment {
  return ENVIRONMENTS.some((environment) => environment.value === value)
}
