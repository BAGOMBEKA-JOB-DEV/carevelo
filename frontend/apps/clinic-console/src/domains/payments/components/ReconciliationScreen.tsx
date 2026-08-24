import {
  Badge,
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
  Stack,
  Stat,
  Toolbar,
} from '@carevelo/ui'
import type { Attempt } from '../api/http'
import {
  RECONCILIATION_FLAGS,
  isKnownFlag,
  methodLabel,
  type ReconciliationDay,
  type ReconciliationRow,
} from '../api/types'
import { NonCustodialNotice } from './NonCustodialNotice'
import { PaymentStatusBadge } from './PaymentStatusBadge'

/**
 * The clinic administrator's daily reconciliation.
 *
 * ------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT ON THIS SCREEN
 *
 * No total collected. No reconciled figure. No variance. No chart of takings. Every one of
 * them would be an assertion about money that never passed through this platform, and a
 * clinic balancing its books against an invented number is worse off than a clinic with no
 * number at all. The two counts that ARE here — how many records exist for the day, and how
 * many are flagged — are counts of RECORDS, and their labels say so.
 *
 * What the screen is for is narrower and actually useful: every attempt we recorded, each
 * carrying the aggregator's own reference, with a flag on the ones that do not look right,
 * so an administrator can open their own aggregator dashboard with a specific reference in
 * hand.
 *
 * ------------------------------------------------------------------
 * ADMINISTRATOR ONLY, AND A 403 IS NOT AN ERROR
 *
 * `PaymentIntentPolicy::reconcile()` admits `clinic_admin` and nobody else. A pharmacist
 * who follows this link is not experiencing a fault, so the screen does not shout at them
 * in red — it says who this screen is for. A generic "You do not have permission to do
 * that." in an error box beside an empty table reads as broken software and produces a
 * support call about a boundary that is working exactly as designed.
 *
 * The tab is still visible to everyone, because this app has no session-role information of
 * its own yet — see the handover note. Hiding it would require a `/v1/me` read from inside
 * this domain, which is the identity domain's business and would be a second copy of it.
 *
 * ------------------------------------------------------------------
 * DATES, AND WHOSE DAY THIS IS
 *
 * The day is resolved by the API in the CLINIC's timezone, from the tenant it already has
 * bound. Nothing here computes "today" — a default computed in this process would be the
 * server's idea of today, which in a UTC container is the wrong day for a Kampala
 * administrator reconciling the evening's takings. An empty date box means "the clinic's
 * today", and the heading shows the day the API actually resolved.
 *
 * BOTH FORMS ARE NATIVE GET FORMS. No client component, no JavaScript: the filters are the
 * URL, which means a day worth looking at can be bookmarked, mailed to a colleague, or
 * reloaded after a dropped connection without losing where you were.
 */

export type ReconciliationScreenProps = {
  result: Attempt<ReconciliationDay>
  /** The `date` search parameter exactly as it arrived, so the form can show it again. */
  date?: string | undefined
  /** `?flagged=1` — a view filter over the day already fetched, never a second request. */
  flaggedOnly: boolean
  /** This screen's own path, for both forms to submit back to. */
  selfPath: string
  /** Where the CSV form posts. A route handler; see app/payments/reconciliation/export. */
  exportPath: string
  /** A sentence from a refused export, carried back by the route handler. */
  exportProblem?: string | undefined
}

export function ReconciliationScreen({
  result,
  date,
  flaggedOnly,
  selfPath,
  exportPath,
  exportProblem,
}: ReconciliationScreenProps) {
  return (
    <Stack gap="6">
      <PageHeader
        title="Reconciliation"
        description={
          <>
            Every payment attempt we recorded for one day, with the reference you need to
            find it in your own aggregator dashboard.
          </>
        }
      />

      <NonCustodialNotice />

      {/*
       * THE SAME BAR THAT SITS ABOVE EVERY LIST IN THIS CONSOLE. It used to be a full
       * `.card` with a "Pick a day" heading over it, while the patient registry's filter was
       * a card with no heading and the audit log's was loose on the page ground — three
       * shapes for one idea, so "where the filters are" was something staff learned once per
       * screen. `.console-bar` in console.css is the one shape, quieter than a card because
       * a toolbar is furniture attached to the list under it rather than a panel with
       * something of its own to say.
       *
       * The heading is not lost, it has moved into the accessibility tree: `label` is the
       * group's accessible name, so a screen-reader user landing on the date box is told
       * what these controls are for — which the visible <h2> never did, because a <div> of
       * inputs beside a heading is not associated with it by anything.
       *
       * `as="form"` with `method="get"`: the filter navigates and the URL carries the state,
       * so a day worth looking at can be bookmarked or mailed to a colleague. No client
       * component, no onChange, and it works with JavaScript switched off.
       */}
      <Toolbar
        as="form"
        method="get"
        action={selfPath}
        label="Pick a day to reconcile"
        className="console-bar"
        actions={
          <Button type="submit" variant="quiet">
            Show
          </Button>
        }
      >
        <Field
          name="date"
          label="Day"
          hint="Leave empty for your clinic&rsquo;s today."
        >
          {(control) => <Input {...control} type="date" defaultValue={date ?? ''} />}
        </Field>

        {/* A single condition rather than one option among several, so a plain checkbox and
            not <Choice>. `.choice__input` and `.choice__text` are borrowed from the shared
            layer so that this row is the same object as every other tickable row in the
            product — the row is the target, not the 18px square inside it. */}
        <label className="row">
          <input
            className="choice__input"
            type="checkbox"
            name="flagged"
            value="1"
            defaultChecked={flaggedOnly}
          />
          <span className="choice__text">Only the ones needing a look</span>
        </label>
      </Toolbar>

      {result.ok ? (
        <DayView day={result.value} flaggedOnly={flaggedOnly} />
      ) : (
        <Refusal status={result.status} message={result.message} />
      )}

      <ExportCard exportPath={exportPath} problem={exportProblem} />
    </Stack>
  )
}

function DayView({ day, flaggedOnly }: { day: ReconciliationDay; flaggedOnly: boolean }) {
  const rows = flaggedOnly ? day.rows.filter((row) => row.flags.length > 0) : day.rows

  return (
    <Card as="section">
      {/* One Stack owns the whole card's rhythm, so nothing inside it carries a margin of
          its own. Six `marginTop`s lived here before, each stating the space BELOW the
          element above it — which is a property of the column and not of any of them. */}
      <Stack gap="5">
        <Inline justify="between">
          <h2 className="title">
            {/*
             * The API returns the day it resolved as a bare `YYYY-MM-DD` in the CLINIC's
             * timezone, and DateTime takes an instant. Midnight UTC is 03:00 the same morning
             * in Africa/Kampala, so the rendered date is the day the administrator asked for;
             * any earlier hour would have rolled it back a day for the whole of East Africa.
             */}
            {day.date === '' ? 'The clinic’s day' : <DateTime value={`${day.date}T00:00:00Z`} />}
          </h2>
          <Inline gap="7" align="start">
            {/* Counts of RECORDS. Never of money — see the header. */}
            <Stat label="Records" value={day.meta.total} />
            <Stat label="Need a look" value={day.meta.flagged} />
          </Inline>
        </Inline>

        {day.unreadable > 0 ? (
          /*
           * SAID OUT LOUD RATHER THAN SWALLOWED. A reconciliation screen quietly showing
           * eleven of twelve records is worse than one showing none: an administrator would
           * balance the clinic's books against it and never learn a line was missing.
           */
          <Notice tone="bad" title="Some records could not be read">
            <p>
              {day.unreadable} record{day.unreadable === 1 ? '' : 's'} for this day came back
              in a shape this console did not recognise and {day.unreadable === 1 ? 'is' : 'are'}{' '}
              not in the table below. The CSV export reads the same records from the same
              source and is the safe copy to work from until this is fixed.
            </p>
          </Notice>
        ) : null}

        {day.meta.note === '' ? null : <p className="muted">{day.meta.note}</p>}

        {/*
         * The empty state lives INSIDE the table now rather than replacing it. The headings
         * and the caption stay put, so the screen does not change shape between a day with
         * records and a day without one — and the caption's warning about what the amounts
         * are still reaches somebody who filtered everything away.
         */}
        <DataTable
          caption="Amounts are what we asked the aggregator to collect, not what reached your account."
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            <EmptyState title={flaggedOnly ? 'Nothing needs a look' : 'No payment records for this day'}>
              {flaggedOnly
                ? 'Every record for this day looks the way we would expect. Untick the filter to see them all.'
                : 'No payment was attempted at this clinic on this day, or the day has not started yet.'}
            </EmptyState>
          }
          columns={[
            {
              key: 'started',
              header: 'Started',
              cell: (row) =>
                row.initiatedAt === null ? (
                  <span className="muted">—</span>
                ) : (
                  <DateTime value={row.initiatedAt} format="time" />
                ),
            },
            {
              /*
               * The reference NAMES the row and is the link, because it is what an
               * administrator is holding when they arrive here from anywhere else. The
               * record page is where the cash attestation and the receipt live.
               */
              key: 'reference',
              header: 'Our reference',
              rowHeader: true,
              cell: (row) => (
                <a className="lnk mono" href={`/payments/records/${encodeURIComponent(row.id)}`}>
                  {row.reference}
                </a>
              ),
            },
            {
              key: 'aggregator',
              header: 'Aggregator reference',
              cell: (row) => (
                <span className="mono">
                  {row.aggregatorReference ?? <span className="muted">—</span>}
                </span>
              ),
            },
            { key: 'method', header: 'How', cell: (row) => methodLabel(row.method) },
            {
              key: 'amount',
              header: 'Requested',
              numeric: true,
              cell: (row) =>
                row.amount === null ? <span className="muted">—</span> : <Money value={row.amount} />,
            },
            {
              key: 'status',
              header: 'Reported',
              cell: (row) => <PaymentStatusBadge status={row.status} />,
            },
            {
              key: 'flags',
              header: 'Needs a look',
              cell: (row) =>
                row.flags.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <Inline as="span" gap="2">
                    {row.flags.map((flag) => (
                      <Badge key={flag} tone={isKnownFlag(flag) ? 'warn' : 'neutral'}>
                        {isKnownFlag(flag) ? RECONCILIATION_FLAGS[flag].label : flag}
                      </Badge>
                    ))}
                  </Inline>
                ),
            },
          ]}
        />

        <FlagLegend rows={rows} />
      </Stack>
    </Card>
  )
}


/**
 * What each flag on this page actually means.
 *
 * Only the flags PRESENT in the rows are explained, rather than the whole catalogue: a wall
 * of definitions for conditions that did not occur is a wall people learn to scroll past,
 * and the one definition that matters today is then lost in it.
 *
 * An unrecognised flag is listed with no explanation rather than omitted. A flag added to
 * the backend and not yet to this list still has to reach the administrator; silently
 * dropping it is the single failure this screen exists to prevent.
 */
function FlagLegend({ rows }: { rows: readonly ReconciliationRow[] }) {
  const present = [...new Set(rows.flatMap((row) => row.flags))]

  if (present.length === 0) {
    return null
  }

  return (
    /* A <dl> wearing `.grid g-2` rather than <Grid>: the primitive's `as` union is
       div/section/ul/ol, and a description list is the right element for a term and its
       meaning. The class does exactly what <Grid cols={2}> would render, including the
       collapse to one column below 700px, and the margin that used to sit on this element
       is now the parent Stack's gap. */
    <dl className="grid g-2">
      {present.map((flag) => (
        <Stack gap="2" key={flag}>
          <dt className="stat__label">
            {isKnownFlag(flag) ? RECONCILIATION_FLAGS[flag].label : flag}
          </dt>
          <dd className="muted">
            {isKnownFlag(flag)
              ? RECONCILIATION_FLAGS[flag].body
              : 'This console does not have a description for this flag yet. Treat it as '
                + 'something to check against your own aggregator dashboard.'}
          </dd>
        </Stack>
      ))}
    </dl>
  )
}

/**
 * The API declined, and the screen says which kind of declining it was.
 *
 * 403 is the boundary working: reconciliation is the clinic administrator's screen. It is
 * rendered as information rather than as a failure, so that the people it is not for stop
 * rather than raise a ticket.
 */
function Refusal({ status, message }: { status: number | null; message: string | null }) {
  if (status === 403) {
    return (
      <Notice tone="info" title="Reconciliation is for the clinic administrator">
        <p>
          This screen lists every payment record for the clinic, which is why it is limited
          to the administrator account. Cash you took at the desk is recorded on the payment
          record itself, and you can still reach that.
        </p>
      </Notice>
    )
  }

  return (
    <Notice tone="bad" title="The day’s records could not be loaded" announce>
      <p>{message ?? 'The request did not reach the API. Try again in a moment.'}</p>
    </Notice>
  )
}

/**
 * The CSV, for the clinic's own books.
 *
 * A NATIVE GET FORM POINTING AT A ROUTE HANDLER, which is what makes the browser treat the
 * response as a download rather than a page: the handler passes through the API's own
 * `Content-Disposition`. No JavaScript, no blob, no click handler.
 *
 * The 92-day cap is the API's and is stated here rather than discovered by a 422 — although
 * the 422 is passed through verbatim if somebody edits the URL, because the API's sentence
 * is better than a guess about what it objected to.
 */
function ExportCard({ exportPath, problem }: { exportPath: string; problem?: string | undefined }) {
  return (
    <Card as="section">
      {/* Still a card and still headed, unlike the filter above it: this is not furniture
          attached to a list, it is a panel that does something and has to explain what. */}
      <Stack gap="4">
        <h2 className="title">Export for your books</h2>
        <p className="muted">
          A CSV of the same records over a range of days. Every line carries the
          aggregator&rsquo;s own reference so you can match it in your dashboard. There is no
          total column, for the reason above.
        </p>

        {problem === undefined ? null : (
          <Notice tone="bad" title="The export was refused" announce>
            <p>{problem}</p>
          </Notice>
        )}

        <Toolbar
          as="form"
          method="get"
          action={exportPath}
          label="Export a range of days as a CSV"
          actions={
            <Button type="submit" variant="quiet">
              Download CSV
            </Button>
          }
        >
          <Field name="from" label="From">
            {(control) => <Input {...control} type="date" required />}
          </Field>
          <Field name="to" label="To" hint="Up to 92 days at a time.">
            {(control) => <Input {...control} type="date" required />}
          </Field>
        </Toolbar>
      </Stack>
    </Card>
  )
}
