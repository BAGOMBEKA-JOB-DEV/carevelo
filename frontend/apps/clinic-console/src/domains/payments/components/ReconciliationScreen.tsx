import { Badge, Button, Card, DateTime, EmptyState, Money, Notice } from '@carevelo/ui'
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
    <div className="grid">
      <div className="page-head">
        <div className="grow">
          <h1>Reconciliation</h1>
          <p>
            Every payment attempt we recorded for one day, with the reference you need to
            find it in your own aggregator dashboard.
          </p>
        </div>
      </div>

      <NonCustodialNotice />

      <Card as="section">
        <h2 className="title">Pick a day</h2>
        <form method="get" action={selfPath} className="row-wrap" style={{ marginTop: 'var(--space-4)' }}>
          <div className="field">
            <label className="field__label" htmlFor="reconciliation-date">
              Day
            </label>
            <input
              className="input"
              type="date"
              id="reconciliation-date"
              name="date"
              defaultValue={date ?? ''}
            />
            <span className="field__hint">Leave empty for your clinic&rsquo;s today.</span>
          </div>

          <label className="row" style={{ alignSelf: 'center' }}>
            <input type="checkbox" name="flagged" value="1" defaultChecked={flaggedOnly} />
            <span>Only the ones needing a look</span>
          </label>

          <Button type="submit" variant="quiet">
            Show
          </Button>
        </form>
      </Card>

      {result.ok ? (
        <DayView day={result.value} flaggedOnly={flaggedOnly} />
      ) : (
        <Refusal status={result.status} message={result.message} />
      )}

      <ExportCard exportPath={exportPath} problem={exportProblem} />
    </div>
  )
}

function DayView({ day, flaggedOnly }: { day: ReconciliationDay; flaggedOnly: boolean }) {
  const rows = flaggedOnly ? day.rows.filter((row) => row.flags.length > 0) : day.rows

  return (
    <Card as="section">
      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
        <h2 className="title">
          {/*
           * The API returns the day it resolved as a bare `YYYY-MM-DD` in the CLINIC's
           * timezone, and DateTime takes an instant. Midnight UTC is 03:00 the same morning
           * in Africa/Kampala, so the rendered date is the day the administrator asked for;
           * any earlier hour would have rolled it back a day for the whole of East Africa.
           */}
          {day.date === '' ? 'The clinic’s day' : <DateTime value={`${day.date}T00:00:00Z`} />}
        </h2>
        <div className="row-wrap">
          {/* Counts of RECORDS. Never of money — see the header. */}
          <span className="stat">
            <span className="stat__label">Records</span>
            <span className="stat__value">{day.meta.total}</span>
          </span>
          <span className="stat">
            <span className="stat__label">Need a look</span>
            <span className="stat__value">{day.meta.flagged}</span>
          </span>
        </div>
      </div>

      {day.unreadable > 0 ? (
        /*
         * SAID OUT LOUD RATHER THAN SWALLOWED. A reconciliation screen quietly showing
         * eleven of twelve records is worse than one showing none: an administrator would
         * balance the clinic's books against it and never learn a line was missing.
         */
        <div style={{ marginTop: 'var(--space-5)' }}>
          <Notice tone="bad" title="Some records could not be read">
            <p>
              {day.unreadable} record{day.unreadable === 1 ? '' : 's'} for this day came back
              in a shape this console did not recognise and {day.unreadable === 1 ? 'is' : 'are'}{' '}
              not in the table below. The CSV export reads the same records from the same
              source and is the safe copy to work from until this is fixed.
            </p>
          </Notice>
        </div>
      ) : null}

      {day.meta.note === '' ? null : (
        <p className="muted" style={{ marginTop: 'var(--space-4)' }}>
          {day.meta.note}
        </p>
      )}

      {rows.length === 0 ? (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <EmptyState title={flaggedOnly ? 'Nothing needs a look' : 'No payment records for this day'}>
            {flaggedOnly
              ? 'Every record for this day looks the way we would expect. Untick the filter to see them all.'
              : 'No payment was attempted at this clinic on this day, or the day has not started yet.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="table-scroll" style={{ marginTop: 'var(--space-5)' }}>
            <table className="table">
              <caption className="fine" style={{ captionSide: 'bottom', textAlign: 'left' }}>
                Amounts are what we asked the aggregator to collect, not what reached your
                account.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Our reference</th>
                  <th scope="col">Aggregator reference</th>
                  <th scope="col">How</th>
                  <th scope="col" className="tnum">
                    Requested
                  </th>
                  <th scope="col">Reported</th>
                  <th scope="col">Needs a look</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          <FlagLegend rows={rows} />
        </>
      )}
    </Card>
  )
}

function Row({ row }: { row: ReconciliationRow }) {
  return (
    <tr>
      <td>
        {row.initiatedAt === null ? (
          <span className="muted">—</span>
        ) : (
          <DateTime value={row.initiatedAt} format="time" />
        )}
      </td>
      <td>
        {/*
         * The reference is the link, because it is what an administrator is holding when
         * they come here from anywhere else. The record page is where the cash attestation
         * and the receipt live.
         */}
        <a className="lnk mono" href={`/payments/records/${encodeURIComponent(row.id)}`}>
          {row.reference}
        </a>
      </td>
      <td className="mono">
        {row.aggregatorReference ?? <span className="muted">—</span>}
      </td>
      <td>{methodLabel(row.method)}</td>
      <td className="tnum">
        {row.amount === null ? <span className="muted">—</span> : <Money value={row.amount} />}
      </td>
      <td>
        <PaymentStatusBadge status={row.status} />
      </td>
      <td>
        {row.flags.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <span className="row-wrap">
            {row.flags.map((flag) => (
              <Badge key={flag} tone={isKnownFlag(flag) ? 'warn' : 'neutral'}>
                {isKnownFlag(flag) ? RECONCILIATION_FLAGS[flag].label : flag}
              </Badge>
            ))}
          </span>
        )}
      </td>
    </tr>
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
    <dl className="grid g-2" style={{ marginTop: 'var(--space-6)' }}>
      {present.map((flag) => (
        <div className="stack" key={flag}>
          <dt className="stat__label">
            {isKnownFlag(flag) ? RECONCILIATION_FLAGS[flag].label : flag}
          </dt>
          <dd className="muted">
            {isKnownFlag(flag)
              ? RECONCILIATION_FLAGS[flag].body
              : 'This console does not have a description for this flag yet. Treat it as '
                + 'something to check against your own aggregator dashboard.'}
          </dd>
        </div>
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
      <h2 className="title">Export for your books</h2>
      <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
        A CSV of the same records over a range of days. Every line carries the
        aggregator&rsquo;s own reference so you can match it in your dashboard. There is no
        total column, for the reason above.
      </p>

      {problem === undefined ? null : (
        <div style={{ marginBlock: 'var(--space-4)' }}>
          <Notice tone="bad" title="The export was refused" announce>
            <p>{problem}</p>
          </Notice>
        </div>
      )}

      <form method="get" action={exportPath} className="row-wrap" style={{ marginTop: 'var(--space-4)' }}>
        <div className="field">
          <label className="field__label" htmlFor="export-from">
            From
          </label>
          <input className="input" type="date" id="export-from" name="from" required />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="export-to">
            To
          </label>
          <input className="input" type="date" id="export-to" name="to" required />
          <span className="field__hint">Up to 92 days at a time.</span>
        </div>
        <Button type="submit" variant="quiet">
          Download CSV
        </Button>
      </form>
    </Card>
  )
}
