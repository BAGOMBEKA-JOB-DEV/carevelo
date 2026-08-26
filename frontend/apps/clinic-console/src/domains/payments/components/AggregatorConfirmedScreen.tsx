import {
  Button,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  Inline,
  Input,
  Money,
  Notice,
  PageHeader,
  Pagination,
  Stack,
  Stat,
  Toolbar,
} from '@carevelo/ui'
import type { Attempt } from '../api/http'
import {
  methodLabel,
  serviceHeading,
  type AggregatorConfirmedPayments,
  type ConfirmedByMethod,
} from '../api/types'

/**
 * What the clinic's own aggregator confirmed this month — and what that is not.
 *
 * ==================================================================
 * THIS SCREEN REPLACES `RevenuePlaceholder`, AND INHERITS ITS ARGUMENT RATHER THAN
 * RETIRING IT
 * ==================================================================
 *
 * The placeholder refused to draw a chart and was right to. Its reasoning, in its own
 * words: the only figures the platform held were counts of ATTEMPTS, so summing them into
 * "revenue" would have asserted that every attempt reported as succeeded reached the
 * clinic's account — "a plausible, precise, confidently-rendered number that nobody could
 * stand behind — and a clinic owner would make decisions on it."
 *
 * ONE SENTENCE OF THAT IS NOW OUT OF DATE AND THE REST IS NOT. `GET /v1/revenue` reports
 * confirmations rather than attempts: a COMPLETED that came back with a confirmation code,
 * which the resolver refuses to record unless the reported amount agrees with the amount we
 * asked to collect. There is a real observation to show.
 *
 * WHAT DID NOT CHANGE, AND WHAT THIS SCREEN DOES ABOUT IT.
 *
 * Money never passes through Carevelo and nobody here can see the clinic's bank account.
 * "The aggregator confirmed it" and "the money arrived" are different statements and only
 * the first is ours. So:
 *
 *   - THE HEADING NAMES THE OBSERVER, not the amount. "Your aggregator confirmed" and never
 *     "Revenue", "Received", "Earned", "Collected" or a bare "Total". The word the figure
 *     hangs from is what a reader carries away when they glance at it, which is why the
 *     backend spent a resource docblock on the same decision about its field names.
 *   - THE SENTENCE THAT SAYS WE CANNOT SEE YOUR BANK ACCOUNT IS THE API'S OWN, RENDERED
 *     VERBATIM. It ships in `meta.not_money_in_the_bank` precisely so it is not a caveat
 *     this app wrote and could quietly soften; the read fails rather than succeeds without
 *     it, so there is no state of this screen in which figures appear and that sentence
 *     does not.
 *   - NOTHING IS ADDED UP HERE. The headline pair is the database's, over the whole window.
 *     The by-service breakdown is ONE CURSOR PAGE and does not sum to it — said on the
 *     screen, because a reader who adds the visible column and gets a smaller number will
 *     otherwise conclude one of the two is wrong.
 *
 * ==================================================================
 * WHY IT IS A SCREEN AND NOT A CARD ON THE MONEY DESK
 * ==================================================================
 *
 * The placeholder sat inside `MoneyDeskScreen` and could, because it fetched nothing. This
 * reads an endpoint that admits `clinic_admin` alone, and the desk is mostly used by
 * front-desk clerks: a card here would answer 403 for most of the people who see it, which
 * reads as broken software rather than as a boundary. So it is its own route with its own
 * tab, beside reconciliation, which is administrator-only for the same reason.
 *
 * ==================================================================
 * NO CHART
 * ==================================================================
 *
 * Not from timidity — from the shape of the data. The endpoint answers ONE window with two
 * breakdowns; it returns no series, no per-day figures and no prior period, so a trend line
 * would have to be assembled from repeated calls and would put a slope on the screen that
 * nothing in the payload supports. A month-over-month comparison is a real product question
 * and is named in the handover as the endpoint change it needs.
 *
 * @see backend/app/Http/Resources/V1/AggregatorConfirmedPaymentsResource.php
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */

export type AggregatorConfirmedScreenProps = {
  result: Attempt<AggregatorConfirmedPayments>
  /** The `from`/`to` search parameters exactly as they arrived, so the form can show them again. */
  from?: string | undefined
  to?: string | undefined
  /** This screen's own path, for the window form and for the pager to build hrefs from. */
  selfPath: string
  /** Where reconciliation is mounted — the screen that carries the references to check. */
  reconciliationPath: string
}

export function AggregatorConfirmedScreen({
  result,
  from,
  to,
  selfPath,
  reconciliationPath,
}: AggregatorConfirmedScreenProps) {
  return (
    <Stack gap="6">
      <PageHeader
        title="What your aggregator confirmed"
        description={
          <>
            Payments your own aggregator reported as completed, placed on the day it
            confirmed them. This is not a statement of what reached your bank account.
          </>
        }
      />

      {/*
        THE WINDOW FORM IS A NATIVE GET FORM, like every other filter in this console. The
        window is the URL, so a month worth looking at can be bookmarked, mailed to an
        accountant, or reloaded after a dropped connection without losing where you were.

        NEITHER BOX IS DEFAULTED. Leaving both empty asks the API for the clinic's own
        current month, resolved in the clinic's timezone from the tenant it already has
        bound. A default computed in this process would be the server's idea of the month,
        which in a UTC container is the wrong month for a Kampala owner for three hours at
        each end of it.
      */}
      <Toolbar
        as="form"
        method="get"
        action={selfPath}
        label="Choose the window of confirmations"
        className="console-bar"
        actions={
          <Button type="submit" variant="quiet">
            Show
          </Button>
        }
      >
        <Field
          name="from"
          label="Confirmed from"
          hint="Leave both empty for this month at your clinic."
        >
          {(control) => <Input {...control} type="date" defaultValue={from ?? ''} />}
        </Field>
        <Field name="to" label="Confirmed to" hint="Up to a year and a day at a time.">
          {(control) => <Input {...control} type="date" defaultValue={to ?? ''} />}
        </Field>
      </Toolbar>

      {result.ok ? (
        <Confirmed
          confirmed={result.value}
          from={from}
          to={to}
          selfPath={selfPath}
          reconciliationPath={reconciliationPath}
        />
      ) : (
        <Refusal status={result.status} message={result.message} />
      )}
    </Stack>
  )
}

function Confirmed({
  confirmed,
  from,
  to,
  selfPath,
  reconciliationPath,
}: {
  confirmed: AggregatorConfirmedPayments
  from: string | undefined
  to: string | undefined
  selfPath: string
  reconciliationPath: string
}) {
  return (
    <Stack gap="6">
      {/*
        THE ONE PLAIN SENTENCE, IN THE API'S OWN WORDS AND NOT IN WORDS WRITTEN HERE.

        `tone="info"` rather than a warning: nothing is wrong, and a red box beside a
        working screen teaches people to ignore red boxes. What it must do is be
        unmissable and be first, above the figure — a caveat under a number is a caveat
        read after the decision has been made.
      */}
      <Notice tone="info" icon="shield" title="This is not money in your bank account">
        <p>{confirmed.caveats.notMoneyInTheBank}</p>
      </Notice>

      <Headline confirmed={confirmed} />

      <ByMethodRecorded rows={confirmed.byMethodRecorded} unreadable={confirmed.unreadableMethodRows} />

      <ByService
        confirmed={confirmed}
        from={from}
        to={to}
        selfPath={selfPath}
        reconciliationPath={reconciliationPath}
      />
    </Stack>
  )
}

/**
 * The two figures, and the paragraph that says what they are.
 *
 * THE COUNT AND THE AMOUNT SIT TOGETHER because either alone invites the wrong reading. An
 * amount with no count hides that one large collection can be a whole month; a count with
 * no amount is a number of events nobody can act on. Both are the database's, over the
 * whole window, and neither moves when the breakdown below is paged.
 */
function Headline({ confirmed }: { confirmed: AggregatorConfirmedPayments }) {
  return (
    <Card as="section" aria-labelledby="confirmed-heading">
      <Stack gap="5">
        <Inline justify="between" gap="4">
          <Stack gap="2" className="grow">
            <h2 className="title" id="confirmed-heading">
              Confirmed by your aggregator
            </h2>
            <p className="muted">
              {/*
                The API returns the window as bare `YYYY-MM-DD` in the CLINIC's own days,
                and `DateTime` takes an instant. Midnight UTC is 03:00 the same morning in
                Africa/Kampala, so the rendered date is the day the administrator asked for;
                any earlier hour would roll it back a day for the whole of East Africa. The
                same reasoning, and the same `T00:00:00Z`, as the reconciliation heading.
              */}
              <DateTime value={`${confirmed.confirmedFrom}T00:00:00Z`} /> to{' '}
              <DateTime value={`${confirmed.confirmedTo}T00:00:00Z`} />
              {confirmed.clinicTimezone === '' ? null : `, in ${confirmed.clinicTimezone}`}
            </p>
          </Stack>

          <Inline gap="7" align="start">
            <Stat
              label="Payments confirmed"
              value={confirmed.count}
              note="Collections, not patients"
            />
            <Stat
              label="Confirmed amount"
              value={
                confirmed.total === null ? (
                  /*
                   * NOT A ZERO, AND NOT A BLANK. An amount that did not arrive in the shape
                   * this build expects is a figure we hold and cannot read, which is a
                   * different thing from a month in which nothing was confirmed — and a
                   * zero would be read as the second. The count beside it is still true and
                   * is still shown.
                   */
                  <span className="muted">Cannot be shown</span>
                ) : (
                  <Money value={confirmed.total} />
                )
              }
              note="What your aggregator reported"
            />
          </Inline>
        </Inline>

        {/* What the figure IS — one sentence, the API's own. */}
        <p className="muted">{confirmed.caveats.counts}</p>

        {/*
          WHAT IT IS NOT, IN WORDS AND NOT IN NUMBERS. The backend is deliberate that this
          list carries no counts: "a count of what was left out would be a second figure on
          a screen whose whole problem is a figure being trusted too readily", and the
          exclusions do not share a date basis with the total anyway — an attempt nobody
          ever confirmed has no confirmation date to fall inside the window. So the list is
          rendered as prose, exactly as long as the API sends it.
        */}
        {confirmed.caveats.doesNotCount.length === 0 ? null : (
          <Stack gap="2">
            <h3 className="title-sm">What this figure does not count</h3>
            {/* `<Stack as="ul">` rather than a bare `<ul>`: Stack removes the user
                agent's 40px indent AND restores `role="list"`, which Safari drops the
                moment `list-style` goes — costing a screen-reader user the "list, 5
                items" announced before the exclusions are read out. On this screen that
                count is the point: it is how somebody listening learns there are five
                things the figure leaves out. */}
            <Stack as="ul" gap="2" className="muted">
              {confirmed.caveats.doesNotCount.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </Stack>
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

/**
 * How the collections were opened — which is OURS to say, and not the aggregator's.
 *
 * `_recorded`, NOT `_confirmed`, AND THE HEADING SAYS SO. Pesapal returns a
 * `payment_method` of its own on GetTransactionStatus and nothing stores it, so this
 * breakdown must not be read as the aggregator confirming which rail the patient used. The
 * amounts are confirmed; the split between them is our own record of how each collection
 * was started. Two different claims in one table, and the caption is where the difference
 * is stated rather than left to be inferred from a field name nobody sees.
 *
 * NOT PAGED, because the set is closed rather than because it is small: `PaymentMethod` has
 * four cases and cash is excluded, so this can never exceed three rows however busy the
 * clinic is.
 */
function ByMethodRecorded({
  rows,
  unreadable,
}: {
  rows: readonly ConfirmedByMethod[]
  unreadable: number
}) {
  return (
    <Card as="section" aria-labelledby="by-method-heading">
      <Stack gap="5">
        <h2 className="title" id="by-method-heading">
          How these collections were opened
        </h2>

        <UnreadableRows count={unreadable} what="ways of paying" />

        <DataTable
          caption="How each collection was started, which is our own record — not something your aggregator confirmed. The amounts are the confirmed ones."
          rows={rows}
          rowKey={(row) => row.methodRecorded}
          empty={
            <EmptyState title="Nothing was confirmed in this window">
              No collection through an aggregator was confirmed as completed between these
              two dates. Cash taken at the counter is never counted here.
            </EmptyState>
          }
          columns={[
            {
              key: 'method',
              header: 'Started as',
              rowHeader: true,
              cell: (row) => methodLabel(row.methodRecorded),
            },
            {
              key: 'count',
              header: 'Payments confirmed',
              numeric: true,
              cell: (row) => row.count,
            },
            {
              key: 'total',
              header: 'Confirmed amount',
              numeric: true,
              cell: (row) => <Money value={row.total} />,
            },
          ]}
        />
      </Stack>
    </Card>
  )
}

/**
 * What patients paid for.
 *
 * A DISPENSING ORDER HAS NO SERVICE AND IS NOT GIVEN ONE. The API sends `service_id` and
 * `service_name` as null with `paid_for` discriminating, and the resource argues why:
 * inventing a heading for it "would file medicines under a service that doesn't exist". An
 * "Other" bucket would do the same damage more quietly, by putting a deleted service and a
 * dispensing order into one row that means neither. So the row is filed under what it was
 * paid for, and the second column says which.
 *
 * PAGED BY CURSOR AND SAID TO BE. The rows on screen are one page of the breakdown and do
 * not add up to the figure above; a reader who adds the column and finds a smaller number
 * has found the pagination, not an error, and the caption tells them so before they start.
 */
function ByService({
  confirmed,
  from,
  to,
  selfPath,
  reconciliationPath,
}: {
  confirmed: AggregatorConfirmedPayments
  from: string | undefined
  to: string | undefined
  selfPath: string
  reconciliationPath: string
}) {
  const next = confirmed.byServiceNextCursor

  return (
    <Card as="section" aria-labelledby="by-service-heading">
      <Stack gap="5">
        <h2 className="title" id="by-service-heading">
          What patients paid for
        </h2>

        <UnreadableRows count={confirmed.unreadableServiceRows} what="services" />

        <DataTable
          caption="One page of the breakdown, ordered by the platform. These rows do not add up to the figure above — the figure covers the whole window and this is a page of it."
          rows={confirmed.byService}
          rowKey={(row) => row.serviceId ?? `~${row.paidFor}`}
          empty={
            <EmptyState title="Nothing to break down">
              No collection through an aggregator was confirmed as completed between these
              two dates.
            </EmptyState>
          }
          columns={[
            {
              key: 'heading',
              header: 'Paid for',
              rowHeader: true,
              cell: (row) => (
                <>
                  {serviceHeading(row)}
                  {/*
                    A service that has since been deleted arrives with an id and no name.
                    Saying so is the difference between "this service takes no money" and
                    "this service is gone" — and an owner reading a takings breakdown is
                    entitled to know which.
                  */}
                  {row.serviceId !== null && row.serviceName === null ? (
                    <>
                      {' '}
                      <span className="muted">— a service that no longer exists</span>
                    </>
                  ) : null}
                </>
              ),
            },
            {
              key: 'count',
              header: 'Payments confirmed',
              numeric: true,
              cell: (row) => row.count,
            },
            {
              key: 'total',
              header: 'Confirmed amount',
              numeric: true,
              cell: (row) => <Money value={row.total} />,
            },
          ]}
        />

        {/*
          CURSOR, NEVER A PAGE NUMBER. `?page=2` is a 422 on this endpoint and there will
          never be one: the aggregate is grouped, a service can be added or a late
          confirmation can create a group between two requests, and an offset would then
          repeat one service and skip another — a breakdown whose rows are individually
          correct and whose sum is wrong. The window travels with the cursor so paging does
          not silently reset it to the current month.
        */}
        <Pagination
          label="Pages of the breakdown by service"
          nextHref={next === null ? undefined : windowHref(selfPath, from, to, next)}
          previousHref={undefined}
          summary={
            next === null
              ? `${confirmed.byService.length} row${confirmed.byService.length === 1 ? '' : 's'}, and no more`
              : 'More services in this window'
          }
        />

        <p className="muted">
          Every confirmation behind these figures has your aggregator&rsquo;s own reference
          against it in{' '}
          <a className="lnk" href={reconciliationPath}>
            reconciliation
          </a>
          , which is where to check any one of them against your aggregator dashboard.
        </p>
      </Stack>
    </Card>
  )
}

/**
 * Rows the API sent that this console could not read.
 *
 * SAID OUT LOUD RATHER THAN SWALLOWED, the same rule the reconciliation day follows. A
 * breakdown quietly missing one service reads as "that service took nothing this month",
 * which is not a missing row — it is a wrong fact about a service line an owner may be
 * about to stop offering.
 */
function UnreadableRows({ count, what }: { count: number; what: string }) {
  if (count === 0) {
    return null
  }

  return (
    <Notice tone="bad" title="Some of this breakdown could not be read">
      <p>
        {count} {count === 1 ? 'row' : 'rows'} of {what} came back in a shape this console
        did not recognise and {count === 1 ? 'is' : 'are'} not in the table below. The
        figures above cover the whole window and are unaffected, so the breakdown adds up to
        less than they do by more than the paging alone would explain.
      </p>
    </Notice>
  )
}

/**
 * This screen's own URL, carrying the window and a cursor.
 *
 * THE WINDOW TRAVELS WITH THE CURSOR. A "next" link that dropped `from` and `to` would page
 * into the second page of a DIFFERENT window — the clinic's current month, which is what
 * the API answers when neither is given — and the rows would look entirely plausible.
 */
function windowHref(
  selfPath: string,
  from: string | undefined,
  to: string | undefined,
  cursor: string,
): string {
  const query = new URLSearchParams()

  if (from !== undefined && from !== '') {
    query.set('from', from)
  }

  if (to !== undefined && to !== '') {
    query.set('to', to)
  }

  query.set('cursor', cursor)

  return `${selfPath}?${query.toString()}`
}

/**
 * The API declined, and the screen says which kind of declining it was.
 *
 * 403 IS THE BOUNDARY WORKING, not a fault: this is the clinic administrator's screen, for
 * the same reason and through the same ability as reconciliation. Rendered as information
 * so the people it is not for stop rather than raise a ticket.
 *
 * A FAILURE IS NEVER RENDERED AS A ZERO. There is no arm of this component that draws a
 * figure, which is the point: the one thing worse than not showing this month's takings is
 * showing "UGX 0" for a month in which the clinic took money.
 */
function Refusal({ status, message }: { status: number | null; message: string | null }) {
  if (status === 403) {
    return (
      <Notice tone="info" title="This screen is for the clinic administrator">
        <p>
          It shows what your aggregator confirmed across the whole clinic, which is why it is
          limited to the administrator account. A payment you took yourself is still on its
          own payment record, and you can reach that.
        </p>
      </Notice>
    )
  }

  return (
    <Notice tone="bad" title="These figures could not be loaded" announce>
      <p>
        {message
          ?? 'The request did not reach the API, or it answered in a shape this console '
            + 'could not read. Nothing is shown rather than a figure that might be wrong.'}
      </p>
    </Notice>
  )
}
