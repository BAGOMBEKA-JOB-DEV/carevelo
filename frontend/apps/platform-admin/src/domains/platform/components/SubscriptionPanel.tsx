import { redirect } from 'next/navigation'
import {
  Badge,
  Button,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  Grid,
  Inline,
  Input,
  Money,
  Notice,
  Select,
  Stack,
} from '@carevelo/ui'
import type { Capabilities } from '@/domains/identity'
import { setSubscriptionPlan, startSubscriptionCollection } from '../api/subscriptions'
import { href } from '../model/links'
import {
  PLANS,
  PLAN_MEANING,
  STANDING_MEANING,
  chargeTone,
  isOnTrial,
  knownPlan,
  pesapalHandoffUrl,
  standingOf,
  type Plan,
  type Subscription,
  type SubscriptionCharge,
} from '../model/subscription'
import type { PlatformPaths } from '../model/types'
import { StandingBadge } from './StandingBadge'
import { StatusBadge } from './StatusBadge'

/**
 * One clinic's subscription to the software: what it agreed, what it has paid, and the two
 * things an administrator may do about it.
 *
 * ==================================================================
 * THIS IS THE ONE SURFACE IN THE PRODUCT WHERE CAREVELO IS THE MERCHANT
 * ==================================================================
 *
 * Everywhere else money moves patient → aggregator → the CLINIC's own account, and Carevelo
 * is not in the path at any point. ADR-0003 is blunt about why: custody would trigger the
 * NPS Act 2020 PSP and e-money-issuer categories at UGX 250m–10bn of capital, and "a design
 * that drifted into custody would not inconvenience the company; it would end it."
 *
 * A clinic's subscription is the exception that ADR names and bounds — a supplier collecting
 * its own fee from its customer, which is not custody of anybody else's money. Nothing on
 * this panel touches a patient, a payment intent or a clinic's own aggregator account, and
 * there is no control here that could.
 *
 * ==================================================================
 * TWO WRITES, DELIBERATELY NOT ONE
 * ==================================================================
 *
 * RECORDING A PRICE AND CHARGING A CLINIC ARE SEPARATE ACTS AND SEPARATE ENDPOINTS. The
 * backend keeps them apart so that a support operator correcting a typo in a price does not
 * thereby charge a clinic, and this panel honours it: two forms, two buttons, and no "save
 * and collect" anywhere. The convenience is real and so is the reason it is refused.
 *
 * ==================================================================
 * THE PRICE BOX IS NOT PRE-FILLED, AND THAT IS THE CONSIDERED CHOICE
 * ==================================================================
 *
 * The current price is on screen through `<Money>` — the same component every other amount
 * in the product renders through. It is NOT put into the input.
 *
 * The wire is asymmetric on purpose: the API accepts WHOLE SHILLINGS on the way in ("nobody
 * in Uganda quotes cents and a platform operator typing a monthly fee should type 250000")
 * and returns MINOR UNITS on the way out. Pre-filling the box would mean dividing
 * `amount_minor` by a hundred in this browser, which is arithmetic on money in a client —
 * the thing this codebase does not do — and the failure mode is not an exception, it is a
 * clinic re-priced by a factor of a hundred by somebody who pressed save without reading.
 *
 * The cost is that an operator retypes the amount to change the plan. That is the right way
 * round: `UpdateSubscriptionRequest` requires plan and price TOGETHER because "a tier alone
 * would have to imply a price from a list, and the first bespoke deal would then make that
 * list a lie". Typing both IS the act of recording what was agreed.
 *
 * ==================================================================
 * SUSPENSION IS NOT REINVENTED HERE
 * ==================================================================
 *
 * There is no "suspend for non-payment" button on this panel and there must not be one.
 * Suspension already exists as a lifecycle control on `TenantPanel`, it is applied
 * automatically by `billing:suspend-lapsed` after a grace period, and it means exactly one
 * thing: staff sign-in is blocked. It does not stop a patient reading their own records, it
 * does not abandon a delivery in flight, and it can never withhold the export. A second
 * suspend control reached from a billing screen would be the same act with a commercial
 * framing around it, which is how a billing dispute becomes a clinical incident.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see backend/app/Http/Controllers/Api/Platform/PlatformSubscriptionController.php
 */

/**
 * Everything the two writes need in order to know where to send the operator back to.
 *
 * FOUR STRINGS AND NOTHING CALLABLE. An inline `'use server'` function is compiled into a
 * server reference whose bound arguments are every variable it captures, and Next SERIALISES
 * those arguments when the closure is created — a function is not serialisable, so capturing
 * a helper arrow throws "Functions cannot be passed directly to Client Components" out of
 * every render of the page. `TenantPanel` carries the same type for the same reason and its
 * comment records how the class of defect was found; this panel was written with it already
 * known rather than discovered a second time.
 */
type PanelReturn = {
  /** Where the billing register is mounted. `?tenant=` is what re-opens this panel on it. */
  registerPath: string
  status: string | undefined
  cursor: string | undefined
  tenantId: string
}

/** Module scope on purpose — see the note on `PanelReturn`. */
function panelHref(to: PanelReturn, problem?: string, message?: string | null): string {
  return href(to.registerPath, {
    status: to.status,
    cursor: to.cursor,
    tenant: to.tenantId,
    problem,
    message: message ?? undefined,
  })
}

export type SubscriptionPanelProps = {
  subscription: Subscription
  can: Capabilities
  paths: PlatformPaths
  /**
   * The instant the whole page was classified against, passed in rather than read here.
   *
   * One render judges every clinic against the same moment. A panel that called `Date.now()`
   * for itself could disagree with the row that opened it, at a boundary, by a millisecond.
   */
  now: number
  /** Carried through every redirect so the operator lands back on the page they were on. */
  status?: string | undefined
  cursor?: string | undefined
  /** A `redirect_url` from a collection that has just been authorised. See below. */
  handoffUrl?: string | undefined
}

export function SubscriptionPanel({
  subscription,
  can,
  paths,
  now,
  status,
  cursor,
  handoffUrl,
}: SubscriptionPanelProps) {
  const standing = standingOf(subscription, now)
  const onTrial = isOnTrial(subscription)
  const current = knownPlan(subscription.plan)

  /*
    THE HAND-OFF URL IS AN INPUT BY THE TIME IT REACHES HERE, NOT A RESULT.

    It arrived on the query string, which is how the collect action gets it back to a screen
    the operator can read it from rather than be redirected to. That makes it identical, on
    arrival, to a string somebody typed into the address bar -- and the notice below tells the
    operator to forward it to a clinic. So it is checked against Pesapal's own hosts before it
    becomes an `href`; anything else is dropped and the notice is simply not drawn. See
    `pesapalHandoffUrl`, which carries the whole argument.
  */
  const handoffLink = pesapalHandoffUrl(handoffUrl)

  /*
    WHETHER THE TRIAL DATE IS IN THE PAST, rather than assuming it is.

    `isOnTrial` is false as soon as a paid period exists, and a paid period does not clear
    `trial_ends_at` -- `RecurringChargeResolver::extendPaidThrough()` writes one and leaves
    the other alone. A clinic that converted early therefore has a trial date still ahead of
    it while this panel is drawing the "not on trial" branch, and the word beside that date
    has to be decided by comparing it with `now` instead of by which branch we are in.
    Saying "Ended" over a future date is a small lie on a screen whose whole job is to be
    the trustworthy account of what a clinic owes.
  */
  const trialEndsAt = subscription.trial_ends_at === null ? null : Date.parse(subscription.trial_ends_at)
  const trialIsPast = trialEndsAt !== null && !Number.isNaN(trialEndsAt) && trialEndsAt < now

  const returnTo: PanelReturn = {
    registerPath: paths.billing,
    status,
    cursor,
    tenantId: subscription.tenant_id,
  }

  async function recordPlan(formData: FormData) {
    'use server'

    /*
     * Nothing that arrives through a form is trusted. The SHAPE is checked here — is this
     * one of the three published tiers, is the price a whole number of shillings — and
     * every fact about the world is settled by the API, which holds the real bounds and
     * says so in its own sentence when it refuses.
     *
     * `subscription.tenant_id` IS A CLOSURE VARIABLE AND NEVER A FORM FIELD. Next encrypts
     * the variables an inline Server Action closes over, so the clinic being re-priced
     * cannot be swapped for another one by editing the page.
     */
    const chosen = String(formData.get('plan') ?? '')
    const typed = String(formData.get('price') ?? '').trim()

    if (!PLANS.includes(chosen as Plan)) {
      return redirect(panelHref(returnTo, 'incomplete'))
    }

    /*
     * WHOLE SHILLINGS, AND THE CHECK IS ON THE STRING RATHER THAN ON `Number()`. `Number('')`
     * is 0, `Number('  12  ')` is 12 and `Number('1e5')` is 100000 — three ways for a box
     * the operator did not fill in, or filled in oddly, to become a price nobody typed. A
     * digits-only test admits exactly what the API accepts and nothing else. The upper bound
     * is deliberately NOT restated: `UpdateSubscriptionRequest` holds it, and a second copy
     * here would be free to disagree with the first.
     */
    if (!/^\d+$/.test(typed)) {
      return redirect(panelHref(returnTo, 'invalid_price'))
    }

    const outcome = await setSubscriptionPlan(subscription.tenant_id, {
      plan: chosen as Plan,
      price: Number(typed),
    })

    if (outcome.kind === 'problem') {
      return redirect(panelHref(returnTo, outcome.problem, outcome.message))
    }

    return redirect(panelHref(returnTo, 'plan_recorded'))
  }

  async function collect() {
    'use server'

    const outcome = await startSubscriptionCollection(subscription.tenant_id)

    if (outcome.kind === 'problem') {
      return redirect(panelHref(returnTo, outcome.problem, outcome.message))
    }

    /*
     * THE REDIRECT URL IS CARRIED BACK AND SHOWN, NOT FOLLOWED.
     *
     * It is Pesapal's hosted page for the CLINIC's administrator to authorise the recurring
     * collection on — a page the operator sitting in Carevelo's console is not the person to
     * complete. Redirecting this browser to it would put a Carevelo employee in front of a
     * clinic's payment authorisation, which is both the wrong person and, if they completed
     * it, an authorisation nobody at the clinic gave.
     *
     * It travels as a `message` on the query string like every other outcome on this
     * surface. `href()` puts it through URLSearchParams, which is what keeps the `&` in a
     * Pesapal URL from truncating everything after it.
     */
    return redirect(panelHref(returnTo, 'collection_started', outcome.handoff.redirect_url))
  }

  return (
    <Card as="section" aria-labelledby="subscription-heading">
      <Stack gap="7">
        <Inline gap="4" justify="between">
          <div className="grow">
            <h2 id="subscription-heading">{subscription.legal_name}</h2>
            <p className="muted">What this clinic pays Carevelo for the software.</p>
          </div>
          <Inline gap="3">
            <StandingBadge standing={standing} />
            <StatusBadge status={subscription.status} />
          </Inline>
        </Inline>

        <p className="muted">{STANDING_MEANING[standing]}</p>

        {/*
          WHAT SUSPENSION IS, STATED WHEREVER A COMMERCIAL DECISION IS BEING MADE. Every
          clause is a thing this product's own documents have got wrong at least once, and a
          billing screen is precisely where somebody reaches for the lever without them.
        */}
        {subscription.status === 'suspended' ? (
          <Notice tone="warn" icon="lock" title="This clinic is suspended">
            Staff sign-in is blocked. Patients still read their own records, a delivery
            already in flight still completes, and the data export stays reachable — the
            clinic is the data controller and leaves with its data regardless of any
            commercial dispute. Resuming is a lifecycle change on the tenant register, not a
            billing control.
          </Notice>
        ) : null}

        {/*
          A COLLECTION THAT STARTED AND WHOSE LINK WE WILL NOT SHOW.

          `handoffUrl` is only ever set when the collect action redirected with
          `collection_started`, so arriving here with a value that did not survive
          `pesapalHandoffUrl` means one of two things: somebody crafted the query string, or
          Pesapal answered from a host this build does not know. Either way the order may be
          real, and a screen that simply drew nothing would leave an operator pressing the
          button again into a refusal they have no explanation for.

          This panel's own rule, stated where the collect button is hidden-or-not: "a control
          that vanishes without explanation is indistinguishable from a bug". The same
          applies to a notice.
        */}
        {handoffUrl !== undefined && handoffLink === null ? (
          <Notice tone="warn" icon="shield" title="The hand-off link was not one we will show">
            <p>
              A collection was started for this clinic, but the address that came back is not
              an https page on Pesapal&rsquo;s own hosts, so it is not being displayed &mdash;
              a link an operator forwards to a clinic has to be one we can vouch for.
            </p>
            <p>
              Do not start another collection: if the order reached Pesapal, a second one is
              refused and two recurring mandates would charge the clinic twice a month. Check
              this clinic in Pesapal&rsquo;s own console, and look at the most recent charge
              below for the reference to quote.
            </p>
          </Notice>
        ) : null}

        {handoffLink === null ? null : (
          <Notice tone="info" icon="ext" title="Send this to the clinic’s administrator">
            <p>
              Pesapal has the recurring instruction. The clinic&rsquo;s own administrator
              authorises it on this page &mdash; not you, and not from this browser:
            </p>
            <p>
              <a className="lnk mono" href={handoffLink} rel="noreferrer noopener">
                {handoffLink}
              </a>
            </p>
            {/*
              WHAT LOSING THIS COSTS, SAID ACCURATELY.

              This paragraph used to say the collection was "already authorised at Pesapal"
              if the link were lost. It is not, and the difference is the whole of what the
              operator has to do next. `SubscriptionBilling::start()` submits the order and
              writes the charge as `initiated`; nothing is authorised until the clinic's
              administrator completes the page above. But `refuseSecondMandate()` blocks on
              that same `initiated` charge -- so a lost link is a dead end, and the only way
              out of it is cancelling the order at Pesapal by hand before starting again.

              Telling an operator that a stuck collection is "already authorised" is the one
              wording that guarantees nobody goes and unsticks it.
            */}
            <p>
              It is shown once, here, and is not stored. Nothing is collected until the
              clinic&rsquo;s administrator authorises it on that page. If the link is lost,
              this clinic cannot simply be collected from again &mdash; the order counts as
              live and a second one is refused, because two recurring mandates would charge
              the clinic twice a month until the clinic noticed. Cancel the existing order in
              Pesapal&rsquo;s own console first, then start the collection again.
            </p>
          </Notice>
        )}

        {/* ---- What is on file ---- */}
        <Grid cols={2} gap="5">
          <Stack gap="2">
            <span className="stat__label">Plan</span>
            <p className="muted">
              {current === null ? (
                subscription.plan === null ? (
                  'No plan agreed.'
                ) : (
                  /* A tier this build has never heard of renders as itself rather than being
                     mislabelled as one of the three. An operator reading an unfamiliar tier
                     name learns something true. */
                  <code>{subscription.plan}</code>
                )
              ) : (
                <>
                  {current} &mdash; {PLAN_MEANING[current]}
                </>
              )}
            </p>

            <span className="stat__label">Agreed price</span>
            <p className="muted">
              {subscription.price === null ? (
                'No price agreed.'
              ) : (
                <>
                  <Money value={subscription.price} /> a month
                </>
              )}
            </p>
          </Stack>

          <Stack gap="2">
            <span className="stat__label">{onTrial ? 'Trial ends' : 'Paid through'}</span>
            <p className="muted">
              {/*
                THE TWO DATES ARE NEVER MERGED INTO ONE FIGURE. `paid through` is the paid
                period where there is one and the trial otherwise — the backend's own line —
                but which of the two it is gets SAID, because calling a trial a paid period
                on a commercial register records a clinic that has never paid a shilling as a
                paying customer.
              */}
              {subscription.current_period_ends_at !== null ? (
                <DateTime value={subscription.current_period_ends_at} format="datetime" />
              ) : subscription.trial_ends_at !== null ? (
                <DateTime value={subscription.trial_ends_at} format="datetime" />
              ) : (
                'Nothing has been collected and no trial is set.'
              )}
            </p>

            {onTrial ? null : (
              <>
                <span className="stat__label">Trial</span>
                <p className="muted">
                  {subscription.trial_ends_at === null ? (
                    'No trial date set.'
                  ) : (
                    <>
                      {trialIsPast ? 'Ended' : 'Ends'}{' '}
                      <DateTime value={subscription.trial_ends_at} />
                    </>
                  )}
                </p>
              </>
            )}
          </Stack>
        </Grid>

        {!can.administerBilling ? (
          <Notice tone="info" icon="lock" title="Read-only on this clinic’s billing">
            Your platform role can read what a clinic is on and whether it has paid. Recording
            a plan and starting a collection need <code>platform_admin</code> &mdash; the same
            permission as suspending a clinic, because both change what a clinic owes. The
            controls are absent rather than disabled so there is nothing here to press that
            would answer with a refusal.
          </Notice>
        ) : (
          <>
            <RecordPlanForm action={recordPlan} current={current} />
            <CollectForm action={collect} subscription={subscription} />
          </>
        )}

        <RecentCharges charges={subscription.recent_charges} />

        <Inline gap="3">
          <a className="lnk" href={href(paths.billing, { status, cursor })}>
            Close this clinic
          </a>
          <a className="lnk" href={href(paths.register, { tenant: subscription.tenant_id })}>
            Open it on the tenant register
          </a>
        </Inline>
      </Stack>
    </Card>
  )
}

/**
 * Record what was agreed. Collects nothing.
 *
 * The plan select IS pre-filled with the current tier — that is a string off the wire and
 * carries no arithmetic. The price box is not; see the panel's header for why at length.
 */
function RecordPlanForm({
  action,
  current,
}: {
  action: (formData: FormData) => Promise<void>
  current: Plan | null
}) {
  return (
    <form action={action}>
      <Stack gap="5">
        <Stack gap="2">
          <h3 className="title-sm">Record the agreed plan and price</h3>
          <p className="muted">
            This writes down what was agreed in conversation. It collects nothing and charges
            nobody &mdash; starting the collection is the separate control below.
          </p>
        </Stack>

        <Field
          name="plan"
          label="Plan"
          hint="The tier says what the clinic gets. The price says what this clinic agreed to pay, and the two are allowed to disagree."
        >
          {(control) => (
            <Select {...control} defaultValue={current ?? ''} required>
              <option value="" disabled>
                Choose a tier
              </option>
              {PLANS.map((plan) => (
                <option key={plan} value={plan}>
                  {plan} &mdash; {PLAN_MEANING[plan]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          name="price"
          label="Price a month, in whole shillings"
          hint="Digits only — 250000, not 250,000 and not 2500.00. There is no published price list and there is not meant to be one: a clinic that negotiated a price keeps it."
        >
          {(control) => (
            <Input
              {...control}
              className="mono"
              type="text"
              inputMode="numeric"
              pattern="[0-9]+"
              autoComplete="off"
              required
            />
          )}
        </Field>

        {/*
          THE BOX IS EMPTY EVERY TIME, INCLUDING WHEN A PRICE IS ALREADY ON FILE, and the
          hint above says so rather than leaving it to be discovered. The API requires the
          plan and the price together, so this form is "record what was agreed" rather than
          "edit a field" — and pre-filling it would mean dividing minor units by a hundred in
          this browser, which is the one arithmetic on money nobody here performs.
        */}
        <Inline gap="3">
          <Button type="submit" variant="primary">
            Record what was agreed
          </Button>
        </Inline>
      </Stack>
    </form>
  )
}

/**
 * Authorise the recurring collection at Pesapal.
 *
 * OFFERED EVEN WITHOUT A PLAN ON FILE, and refused by the API with its own sentence. The
 * alternative — hiding the button until a plan exists — is a second copy of the rule, and
 * the failure mode of a client-side copy is a control that vanishes for a reason nobody can
 * see from the screen. The paragraph beside it says what is needed first.
 */
function CollectForm({
  action,
  subscription,
}: {
  action: () => Promise<void>
  subscription: Subscription
}) {
  return (
    <form action={action}>
      <Stack gap="5">
        <Stack gap="2">
          <h3 className="title-sm">Start the recurring collection</h3>
          <p className="muted">
            Tells Pesapal a monthly collection is authorised against Carevelo&rsquo;s own
            merchant account, and returns the page the clinic&rsquo;s administrator
            authorises it on. This is the only place in the product where Carevelo is the
            merchant; a patient&rsquo;s payment cannot reach that account and no control here
            could make it.
          </p>
          <p className="muted">
            A plan and a price have to be on file first. A second collection for the same
            clinic is refused &mdash; two recurring mandates at Pesapal means the clinic pays
            twice a month until the clinic notices &mdash; so changing a plan
            mid-subscription needs the old mandate cancelled at Pesapal by hand.
          </p>
        </Stack>

        {subscription.plan === null || subscription.price === null ? (
          <Notice tone="info" title="Nothing is on file to collect">
            Record the agreed plan and price above first. The button is still here rather
            than hidden, and the API refuses in its own words &mdash; a control that vanishes
            without explanation is indistinguishable from a bug.
          </Notice>
        ) : null}

        <Inline gap="3">
          <Button type="submit" variant="quiet">
            Authorise the monthly collection
          </Button>
        </Inline>
      </Stack>
    </form>
  )
}

/**
 * What became of the last year of charges.
 *
 * THE AGGREGATOR REFERENCE IS THE USEFUL COLUMN, exactly as it is on the clinic-side
 * reconciliation screen: it is Pesapal's confirmation code, an identifier for a support
 * conversation, and never a fact anything acts on. `merchant_reference` is ours and is the
 * one to quote back to Pesapal.
 *
 * NO TOTAL, AND NO COUNT OF WHAT WAS COLLECTED. This is a support view of one clinic's
 * charges, not an accounting figure, and a sum here would be the beginning of a revenue
 * report drawn from twelve rows on a panel.
 */
function RecentCharges({ charges }: { charges: readonly SubscriptionCharge[] }) {
  return (
    <Stack gap="4">
      <h3 className="title-sm">Recent charges</h3>

      <DataTable
        caption="The last twelve attempts to collect this clinic’s monthly fee, newest first."
        rows={charges}
        rowKey={(charge) => charge.id}
        empty={
          <EmptyState title="Nothing has ever been collected">
            No charge has been raised against this clinic. That is expected for a clinic on
            trial, and for one whose recurring collection has not been authorised yet.
          </EmptyState>
        }
        columns={[
          {
            key: 'period',
            header: 'Period',
            rowHeader: true,
            cell: (charge) => (
              <>
                {/*
                  Bare `YYYY-MM-DD` in the clinic's own days — Pesapal's recurring API has no
                  time in these — so `T00:00:00Z` and not an earlier hour: midnight UTC is
                  03:00 the same morning in Kampala, and anything earlier rolls the date back
                  a day for the whole of East Africa.
                */}
                <DateTime value={`${charge.period_starts_on}T00:00:00Z`} /> &ndash;{' '}
                <DateTime value={`${charge.period_ends_on}T00:00:00Z`} />
              </>
            ),
          },
          { key: 'plan', header: 'Plan', cell: (charge) => charge.plan },
          {
            key: 'amount',
            header: 'Amount',
            numeric: true,
            cell: (charge) => <Money value={charge.amount} />,
          },
          {
            key: 'status',
            header: 'Outcome',
            cell: (charge) => (
              <Inline as="span" gap="2">
                <Badge tone={chargeTone(charge.status)}>{charge.status}</Badge>
                {charge.failure_code === null ? null : (
                  <code className="mono">{charge.failure_code}</code>
                )}
              </Inline>
            ),
          },
          {
            key: 'ours',
            header: 'Our reference',
            cell: (charge) => <span className="mono">{charge.merchant_reference}</span>,
          },
          {
            key: 'theirs',
            header: 'Pesapal reference',
            cell: (charge) => (
              <span className="mono">
                {charge.aggregator_reference ?? <span className="muted">—</span>}
              </span>
            ),
          },
          {
            key: 'resolved',
            header: 'Answered',
            cell: (charge) =>
              charge.resolved_at === null ? (
                <span className="muted">not yet</span>
              ) : (
                <DateTime value={charge.resolved_at} format="datetime" />
              ),
          },
        ]}
      />
    </Stack>
  )
}
