import { Button, Card, DateTime, EmptyState, Notice } from '@carevelo/ui'
import type { Attempt } from '../api/http'
import {
  CHANNEL_LABELS,
  STATUS_LABELS,
  TEMPLATE_LABELS,
  channelLabel,
  templateLabel,
  type NotificationFilters,
  type NotificationPage,
} from '../api/types'
import { NotificationStatusBadge } from './NotificationStatusBadge'

/**
 * What the clinic actually sent.
 *
 * ------------------------------------------------------------------
 * THE RECIPIENT IS MASKED, AND THIS SCREEN DOES NOT UNMASK IT
 *
 * The API returns it already masked and the reason is worth understanding rather than
 * working around: staff reach a patient's message history from the patient's own record,
 * where they already have the number. Returning it in full on a LIST endpoint would turn the
 * send history into a way to enumerate the clinic's patients by phone number — which is a
 * disclosure that a given person is a patient here, and that is the disclosure that matters
 * most in this product.
 *
 * So there is no "reveal" control, no export of this table, and no lookup by number. The
 * screen states the constraint where somebody would otherwise go looking for a way round it.
 *
 * ------------------------------------------------------------------
 * THE BODY IS SHOWN IN FULL, AND THAT IS SAFE BY CONSTRUCTION
 *
 * Every message is rendered from a closed template catalogue asserted against a
 * prohibited-content list, so no message here carries clinical content. What was actually
 * sent is also the fact in dispute when a patient complains, so showing it is the point.
 *
 * ------------------------------------------------------------------
 * FILTERS ARE THE URL, AND CHANGING ONE DROPS THE CURSOR
 *
 * The filter form is a native GET form with no cursor field in it, so submitting it starts
 * from the first page. That is not an omission — carrying a cursor across a filter change
 * would page into a result set the cursor was never cut from, and the API would either
 * error or, worse, answer from a position that means nothing.
 */

export type SendHistoryProps = {
  page: Attempt<NotificationPage>
  filters: NotificationFilters
  selfPath: string
}

export function SendHistory({ page, filters, selfPath }: SendHistoryProps) {
  return (
    <Card as="section">
      <h2 className="title">What we sent</h2>
      <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
        Every message this clinic sent, and what became of it. Phone numbers are shortened on
        purpose — the full number is on the patient&rsquo;s own record.
      </p>

      <Filters filters={filters} selfPath={selfPath} />

      {page.ok ? (
        <Results page={page.value} filters={filters} selfPath={selfPath} />
      ) : (
        <div style={{ marginTop: 'var(--space-5)' }}>
          {page.status === 403 ? (
            <Notice tone="info" title="The message log is the clinic administrator’s view">
              <p>
                It names which patients the clinic contacted and when, so it is not a general
                staff screen. A patient&rsquo;s own messages are on their record.
              </p>
            </Notice>
          ) : (
            <Notice tone="bad" title="The message log could not be loaded" announce>
              <p>{page.message ?? 'The request did not reach the API. Try again in a moment.'}</p>
            </Notice>
          )}
        </div>
      )}
    </Card>
  )
}

function Filters({ filters, selfPath }: { filters: NotificationFilters; selfPath: string }) {
  return (
    <form method="get" action={selfPath} className="row-wrap" style={{ marginTop: 'var(--space-5)' }}>
      <div className="field">
        <label className="field__label" htmlFor="filter-status">
          What became of it
        </label>
        <select className="select" id="filter-status" name="status" defaultValue={filters.status ?? ''}>
          <option value="">Any</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-channel">
          Channel
        </label>
        <select className="select" id="filter-channel" name="channel" defaultValue={filters.channel ?? ''}>
          <option value="">Any</option>
          {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="filter-template">
          Message
        </label>
        {/* A select and not a text box: the catalogue is a closed list, so free text could
            only ever produce a validation error. */}
        <select
          className="select"
          id="filter-template"
          name="template_key"
          defaultValue={filters.templateKey ?? ''}
        >
          <option value="">Any</option>
          {Object.entries(TEMPLATE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="quiet">
        Filter
      </Button>
    </form>
  )
}

function Results({
  page,
  filters,
  selfPath,
}: {
  page: NotificationPage
  filters: NotificationFilters
  selfPath: string
}) {
  if (page.notifications.length === 0) {
    return (
      <div style={{ marginTop: 'var(--space-5)' }}>
        <EmptyState title="No messages match">
          Nothing was sent under these filters. Clear them to see the whole log.
        </EmptyState>
      </div>
    )
  }

  return (
    <>
      <div className="table-scroll" style={{ marginTop: 'var(--space-5)' }}>
        <table className="table">
          <caption className="fine" style={{ captionSide: 'bottom', textAlign: 'left' }}>
            &ldquo;Sent to the gateway&rdquo; means the gateway accepted it. Only
            &ldquo;delivered to the handset&rdquo; means it arrived, and only where the
            gateway reports receipts.
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Message</th>
              <th scope="col">Channel</th>
              <th scope="col">To</th>
              <th scope="col">What became of it</th>
              <th scope="col">What was sent</th>
            </tr>
          </thead>
          <tbody>
            {page.notifications.map((notification) => (
              <tr key={notification.id}>
                <td>
                  {notification.created_at === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <DateTime value={notification.created_at} format="datetime" />
                  )}
                </td>
                <td>{templateLabel(notification.template_key)}</td>
                <td>{channelLabel(notification.channel)}</td>
                <td className="mono">{notification.recipient}</td>
                <td>
                  <NotificationStatusBadge status={notification.status} />
                  {notification.delivered_at === null ? null : (
                    <div className="fine">
                      <DateTime value={notification.delivered_at} format="datetime" />
                    </div>
                  )}
                  {notification.failure_reason === null ? null : (
                    /* The gateway's own reason, verbatim. Paraphrasing loses the part
                       somebody can act on — "unknown subscriber" and "rate_limited" call
                       for entirely different responses. */
                    <div className="fine">{notification.failure_reason}</div>
                  )}
                </td>
                <td>{notification.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} filters={filters} selfPath={selfPath} />
    </>
  )
}

/**
 * Cursor pagination, as two links.
 *
 * CURSOR AND NEVER OFFSET. The clinic is sending messages while an administrator reads this,
 * and that is exactly the traffic under which an offset duplicates and skips rows. A skipped
 * row here is a message somebody concludes was never sent.
 *
 * The filters travel with the cursor because a cursor is only meaningful against the result
 * set it was cut from.
 */
function Pagination({
  page,
  filters,
  selfPath,
}: {
  page: NotificationPage
  filters: NotificationFilters
  selfPath: string
}) {
  if (page.nextCursor === null && page.prevCursor === null) {
    return null
  }

  return (
    <nav className="row-wrap" style={{ marginTop: 'var(--space-5)' }} aria-label="More messages">
      {page.prevCursor === null ? null : (
        <a className="lnk" href={hrefFor(selfPath, filters, page.prevCursor)}>
          Newer
        </a>
      )}
      {page.nextCursor === null ? null : (
        <a className="lnk" href={hrefFor(selfPath, filters, page.nextCursor)}>
          Older
        </a>
      )}
    </nav>
  )
}

function hrefFor(selfPath: string, filters: NotificationFilters, cursor: string): string {
  const query = new URLSearchParams()

  if (filters.status !== undefined) {
    query.set('status', filters.status)
  }

  if (filters.channel !== undefined) {
    query.set('channel', filters.channel)
  }

  if (filters.templateKey !== undefined) {
    query.set('template_key', filters.templateKey)
  }

  query.set('cursor', cursor)

  return `${selfPath}?${query.toString()}`
}
