import {
  Button,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  Inline,
  Money,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Stack,
  Stat,
  Toolbar,
} from '@carevelo/ui'
import type { Capabilities } from '@/domains/identity'
import { readSubscriptionRegister, type SubscriptionRow } from '../api/subscriptions'
import { href } from '../model/links'
import { STATUSES } from '../model/status'
import {
  DUE_SOON_DAYS,
  STANDING_LABEL,
  STANDING_MEANING,
  isOnTrial,
  standingOf,
  type Standing,
} from '../model/subscription'
import type { PlatformPaths } from '../model/types'
import { StandingBadge } from './StandingBadge'
import { StatusBadge } from './StatusBadge'
import { SubscriptionPanel } from './SubscriptionPanel'

/**
 * Who is due, who has lapsed, and what each clinic is on.
 *
 * ==================================================================
 * READ THIS FIRST: THIS SCREEN IS N REQUESTS AND SAYS SO ON ITS FACE
 * ==================================================================
 *
 * `GET /v1/platform/tenants` returns `PlatformTenantResource`, which carries `status`,
 * `is_suspended` and `trial_ends_at` — AND NO `plan`, NO `price` AND NO
 * `current_period_ends_at`. Those live on `PlatformSubscriptionResource`, reachable one
 * clinic at a time. There is no `GET /v1/platform/subscriptions`.
 *
 * So the question this screen exists to answer cannot be asked in one request. It reads a
 * page of the register and then reads each clinic on that page — one HTTP call per row,
 * bounded by a page size this screen chooses rather than inherits.
 *
 * THE CONSEQUENCE IS STATED ON SCREEN AND NOT WORKED AROUND. Sorting and filtering by
 * standing would only ever be sorting and filtering WITHIN a page, which is the failure this
 * console has already been bitten by once: `api/tenants.ts` records that a client-side scan
 * across pages "gets slower with every clinic Carevelo signs and fails silently at page
 * two". So this screen offers no standing filter at all. It shows the page, marks every row,
 * counts the standings ON THAT PAGE with a label that says the count is of that page, and
 * says plainly that the register is walked by cursor.
 *
 * WHAT THE OPERATOR CAN STILL DO, HONESTLY: filter by lifecycle status, which IS a real API
 * filter. `status=suspended` is the clinics the sweep has already acted on — the lapsed
 * ones — and `status=active` walked page by page is the list to chase before it does.
 *
 * WHAT WOULD CLOSE THE GAP: `plan` and `current_period_ends_at` on `PlatformTenantResource`,
 * or a subscriptions index. Reported in the handover rather than solved more cleverly here,
 * because every cleverer version is still N requests and a worse lie about completeness.
 *
 * ==================================================================
 * THE STANDING COLUMN NEVER PREDICTS A SUSPENSION
 * ==================================================================
 *
 * Suspension is decided by `billing:suspend-lapsed`, hourly, against a grace period held in
 * `config/billing.php` and published on no endpoint. A column that said "suspended in three
 * days" would be asserting a number copied out of a backend config file into a browser,
 * where it would go on being asserted confidently after somebody changed it.
 *
 * So there are two columns and they say different kinds of thing. STANDING is a reading of
 * the clinic's own dates — the period ends here. STATE is the lifecycle badge, which is what
 * the platform has actually DONE. Suspension already exists as a control; this surfaces it.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see backend/app/Console/Commands/SuspendLapsedSubscriptionsCommand.php
 */

/**
 * How many clinics one page of this register carries.
 *
 * THE PAGE SIZE IS THE REQUEST COUNT, which is why this is a named constant with an argument
 * attached rather than the API's own default of fifty. Twenty-five is a screenful somebody
 * works down with a phone in their hand, and twenty-five concurrent reads is a fan-out
 * that stays reasonable on the day Carevelo has two hundred clinics. It is well under the
 * API's maximum of a hundred, deliberately: this is a working list, not a bulk export.
 */
const PER_PAGE = 25

export type BillingRegisterScreenProps = {
  can: Capabilities
  paths: PlatformPaths
  /** Every search parameter arrives as it was on the URL and is interpreted here, not in the route. */
  status?: string | undefined
  cursor?: string | undefined
  tenant?: string | undefined
  problem?: string | undefined
  message?: string | undefined
}

export async function BillingRegisterScreen({
  can,
  paths,
  status,
  cursor,
  tenant,
  problem,
  message,
}: BillingRegisterScreenProps) {
  /*
   * ONE INSTANT FOR THE WHOLE PAGE, read once here and passed down.
   *
   * Every row and the open panel are classified against the same moment. Reading the clock
   * per row means a list where row twenty-five was judged milliseconds after row one, and at
   * a boundary that puts two clinics with identical dates in different columns — a
   * difference nobody could reproduce or explain.
   */
  const now = Date.now()

  /*
   * The status filter is the API's own and is validated against the contract's closed set
   * before it is sent. An unknown value is dropped rather than forwarded, which would come
   * back a 422 about a parameter the operator did not type.
   *
   * A TYPE GUARD RATHER THAN `as never`, and the query is BUILT rather than declared. Both
   * are `exactOptionalPropertyTypes`, which is on in this workspace: `TenantQuery` comes
   * from the generated contract, so `status` is `status?: TenantStatus` and NOT
   * `TenantStatus | undefined`. Writing `{ status: undefined }` is therefore a type error
   * rather than an omission, and casting it away would have hidden the one thing the flag
   * exists to tell us — that "absent" and "present but undefined" are different requests.
   * Spreading the key only when it has a value sends no parameter at all, which is what
   * "no filter" actually means to the API.
   */
  const filter = STATUSES.find((state) => state === status)

  let register
  try {
    register = await readSubscriptionRegister(
      { ...(filter ? { status: filter } : {}), ...(cursor ? { cursor } : {}) },
      PER_PAGE,
    )
  } catch {
    /*
     * The register itself could not be read — not one clinic's subscription, the page. A
     * notice rather than a throw, for the same reason every screen in this domain degrades:
     * the framework's error boundary tells an operator nothing and looks like the console
     * is broken.
     */
    return (
      <Stack gap="6">
        <Header paths={paths} />
        <Notice tone="bad" title="The billing register could not be loaded" announce>
          <p>Try again in a moment. Nothing was changed.</p>
        </Notice>
      </Stack>
    )
  }

  const open = register.rows.find((row) => row.tenant.id === tenant)

  return (
    <Stack gap="6">
      <Header paths={paths} />

      <Outcome problem={problem} message={message} />

      {/*
        THE STANDING SIGNPOST, WHICH IS ALSO THE HONESTY NOTICE. It has to be on the page
        every time rather than behind a disclosure: a count of "past due" that a reader takes
        for a count across the register is exactly the misreading this screen can produce,
        and it produces it silently.
      */}
      <Notice tone="info" title="This page, and not the whole register">
        <p>
          There is no endpoint that returns every clinic&rsquo;s plan and paid-through date
          together, so this screen reads the register a page at a time and then reads each
          clinic on the page individually. The figures below count the {register.rows.length}{' '}
          {register.rows.length === 1 ? 'clinic' : 'clinics'} on this page. Walk the pages to
          see the rest, or filter by state &mdash; that filter is the API&rsquo;s own and
          does cover the whole register.
        </p>
        <p>
          &ldquo;Due soon&rdquo; means the paid period ends within {DUE_SOON_DAYS} days. It
          is how far ahead this screen looks, not a deadline anything enforces: whether staff
          sign-in is actually blocked is the clinic&rsquo;s state, in the column beside it.
        </p>
      </Notice>

      <Toolbar
        as="form"
        method="get"
        action={paths.billing}
        label="Filter the register by the clinic’s state"
        className="console-bar"
        actions={
          <Button type="submit" variant="quiet">
            Show
          </Button>
        }
      >
        <Field
          name="status"
          label="State"
          hint="The API’s own filter, across the whole register. Suspended is where a lapsed subscription ends up."
        >
          {(control) => (
            <Select {...control} defaultValue={filter ?? ''}>
              <option value="">Every state</option>
              {STATUSES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Toolbar>

      <Card as="section" padding="tight">
        <Stack gap="5">
          <ThisPage rows={register.rows} now={now} />

          {register.unreadable === 0 ? null : (
            /*
             * SAID OUT LOUD RATHER THAN SWALLOWED. A billing register quietly showing eleven
             * of twelve clinics is worse than one showing none: somebody works through the
             * list, reaches the end, and believes they are finished.
             */
            <Notice tone="bad" title="Some clinics could not be read">
              <p>
                {register.unreadable} of the {register.rows.length} clinics on this page
                answered with nothing when their subscription was read. They are in the table
                below with their commercial columns empty, marked as unread rather than as
                having no plan &mdash; those are different things and only one of them means
                there is nothing to do.
              </p>
            </Notice>
          )}

          <BillingTable rows={register.rows} now={now} paths={paths} status={status} cursor={cursor} />

          <Pagination
            label="Pages of the billing register"
            nextHref={
              register.nextCursor === null
                ? undefined
                : href(paths.billing, { status, cursor: register.nextCursor })
            }
            /*
              THE API'S OWN `prev_cursor`, NOT THE FILTER ON ITS OWN.
              This control used to be built from `{ status }` alone, which is the address of
              the FIRST page -- so from page four "Previous" returned the operator to page
              one while claiming to step back by one. A keyset page has no arithmetic
              previous; the cursor the API minted is the only thing that knows where it
              starts. `TenantRegisterScreen` beside this has always read it.
            */
            previousHref={
              register.prevCursor === null
                ? undefined
                : href(paths.billing, { status, cursor: register.prevCursor })
            }
            summary={`${register.rows.length} of the register, ${PER_PAGE} to a page`}
          />
        </Stack>
      </Card>

      {open === undefined ? null : open.subscription === null ? (
        <Notice tone="bad" title="That clinic’s subscription could not be read">
          <p>
            The row is on this page and the subscription behind it did not answer. Nothing is
            shown rather than an empty panel that would read as a clinic with no plan agreed.
          </p>
        </Notice>
      ) : (
        <SubscriptionPanel
          subscription={open.subscription}
          can={can}
          paths={paths}
          now={now}
          status={status}
          cursor={cursor}
          /* The Pesapal hand-off URL travels back on `message` after a collection is
             authorised, and only then. See `SubscriptionPanel`'s `collect` action. */
          handoffUrl={problem === 'collection_started' ? message : undefined}
        />
      )}
    </Stack>
  )
}

function Header({ paths }: { paths: PlatformPaths }) {
  return (
    <Stack gap="4">
      <PageHeader
        title="Billing"
        description={
          <>
            What each clinic agreed to pay Carevelo for the software, and whether it has. The
            only money in this product that is Carevelo&rsquo;s.
          </>
        }
      />
      <Inline gap="4">
        <a className="lnk" href={paths.overview}>
          Platform overview
        </a>
        <a className="lnk" href={paths.register}>
          Tenant register
        </a>
      </Inline>
    </Stack>
  )
}

/**
 * The standings on this page, counted, with a label that says so.
 *
 * "ON THIS PAGE" IS IN EVERY LABEL AND NOT ONLY IN THE NOTICE ABOVE. A figure is read in
 * isolation — somebody glances at "4 past due" and carries the number away — so the caveat
 * belongs on the thing that carries it, the same discipline the payments API applies by
 * prefixing every field with the observer's name.
 */
function ThisPage({ rows, now }: { rows: readonly SubscriptionRow[]; now: number }) {
  const counted = (standing: Standing) =>
    rows.filter(
      (row) => row.subscription !== null && standingOf(row.subscription, now) === standing,
    ).length

  return (
    <Inline gap="7" align="start">
      <Stat label="Past due, on this page" value={counted('past_due')} />
      <Stat label="Due soon, on this page" value={counted('due_soon')} />
      <Stat label="Never collected, on this page" value={counted('never_collected')} />
      <Stat label="No plan agreed, on this page" value={counted('no_commercial_record')} />
    </Inline>
  )
}

function BillingTable({
  rows,
  now,
  paths,
  status,
  cursor,
}: {
  rows: readonly SubscriptionRow[]
  now: number
  paths: PlatformPaths
  status: string | undefined
  cursor: string | undefined
}) {
  return (
    <DataTable
      caption="Every clinic on this page of the register, with what it agreed to pay and when its paid period ends."
      rows={rows}
      rowKey={(row) => row.tenant.id}
      empty={
        <EmptyState title="No clinics on this page">
          Either no clinic matches the state filter, or the register ends here.
        </EmptyState>
      }
      columns={[
        {
          key: 'clinic',
          header: 'Clinic',
          rowHeader: true,
          cell: (row) => (
            <a
              className="lnk"
              href={href(paths.billing, { status, cursor, tenant: row.tenant.id })}
            >
              {row.tenant.trading_name ?? row.tenant.legal_name}
            </a>
          ),
        },
        {
          key: 'plan',
          header: 'Plan',
          cell: (row) =>
            row.subscription === null ? (
              <span className="muted">not read</span>
            ) : row.subscription.plan === null ? (
              <span className="muted">none agreed</span>
            ) : (
              row.subscription.plan
            ),
        },
        {
          key: 'price',
          header: 'A month',
          numeric: true,
          cell: (row) =>
            row.subscription?.price == null ? (
              <span className="muted">—</span>
            ) : (
              <Money value={row.subscription.price} />
            ),
        },
        {
          key: 'through',
          header: 'Paid through',
          cell: (row) => <PaidThrough row={row} />,
        },
        {
          key: 'standing',
          header: 'Standing',
          cell: (row) =>
            row.subscription === null ? (
              /*
               * NOT A BADGE. A clinic whose subscription could not be read must not wear a
               * standing, because every standing is a claim about dates this screen did not
               * manage to see — and "no plan agreed" beside a clinic that has one is the
               * one row an operator would then skip.
               */
              <span className="muted">not read</span>
            ) : (
              <StandingBadge standing={standingOf(row.subscription, now)} />
            ),
        },
        {
          key: 'state',
          header: 'State',
          cell: (row) => <StatusBadge status={row.tenant.status} />,
        },
      ]}
    />
  )
}

/**
 * When this clinic stops being paid for, and whether that is a paid period or a trial.
 *
 * THE WORD "TRIAL" IS NEVER DROPPED. `paid through` is the paid period where there is one
 * and the trial otherwise — the backend's own fallback — but which of the two it is has to
 * be said, because a register that called a trial a paid period would record every clinic
 * that has never paid a shilling as a paying customer.
 */
function PaidThrough({ row }: { row: SubscriptionRow }) {
  const subscription = row.subscription

  if (subscription === null) {
    return <span className="muted">not read</span>
  }

  if (subscription.current_period_ends_at !== null) {
    return <DateTime value={subscription.current_period_ends_at} />
  }

  if (isOnTrial(subscription)) {
    return (
      <>
        <DateTime value={subscription.trial_ends_at as string} />{' '}
        <span className="muted">(trial)</span>
      </>
    )
  }

  return <span className="muted">—</span>
}

/**
 * What the last write had to say about itself.
 *
 * A CODE RATHER THAN A SENTENCE ON THE WIRE. A Server Action cannot hand a value back to a
 * form that posted natively, so the outcome travels in the query string and the route passes
 * it back in. Each needs a different shape of response, and a sentence assembled inside an
 * action is a sentence nobody can find later.
 *
 * `collection_started` IS HANDLED BY THE PANEL AND NOT HERE, because its `message` is a
 * Pesapal URL rather than a sentence, and the place to show it is beside the clinic it
 * belongs to.
 */
function Outcome({ problem, message }: { problem?: string | undefined; message?: string | undefined }) {
  if (problem === undefined || problem === 'collection_started') {
    return null
  }

  if (problem === 'plan_recorded') {
    return (
      <Notice tone="info" title="Recorded" announce>
        <p>
          The plan and price are on file. Nothing was collected and nobody was charged &mdash;
          starting the collection is a separate control on the clinic&rsquo;s panel.
        </p>
      </Notice>
    )
  }

  if (problem === 'invalid_price') {
    return (
      <Notice tone="warn" title="That is not a price this can send" announce>
        <p>
          A monthly price is whole shillings and digits only &mdash; 250000, not 250,000 and
          not 2500.00. Nothing was sent to the API and nothing was changed.
        </p>
      </Notice>
    )
  }

  if (problem === 'incomplete') {
    return (
      <Notice tone="warn" title="That form was not complete" announce>
        <p>Both the plan and the price are needed together. Nothing was changed.</p>
      </Notice>
    )
  }

  const title =
    problem === 'refused'
      ? 'Your platform role cannot do that'
      : problem === 'not_found'
        ? 'That clinic is not there'
        : problem === 'invalid'
          ? 'The API refused that'
          : 'That did not go through'

  return (
    <Notice tone="bad" title={title} announce>
      {/*
        THE API'S OWN SENTENCE, UNCHANGED. `ApiError` has already put RFC 9457 problem
        details through `humanise()`, and the API is the authority on why it refused — a
        paraphrase written here loses the part the operator can act on. A 503 arrives on this
        path and its detail is the honest one: the platform has no merchant account
        configured, so nothing was charged and nothing was recorded.
      */}
      <p>{message ?? 'The request did not reach the API. Nothing was changed.'}</p>
    </Notice>
  )
}

/** The standings, explained once, under the table that uses them. */
export function StandingLegend() {
  return (
    <dl className="grid g-2">
      {(Object.keys(STANDING_LABEL) as Standing[]).map((standing) => (
        <Stack gap="2" key={standing}>
          <dt className="stat__label">{STANDING_LABEL[standing]}</dt>
          <dd className="muted">{STANDING_MEANING[standing]}</dd>
        </Stack>
      ))}
    </dl>
  )
}
