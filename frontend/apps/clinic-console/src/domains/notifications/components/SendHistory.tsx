import {
  Button,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  Inline,
  Notice,
  Select,
  Stack,
  Toolbar,
} from '@carevelo/ui'
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
      {/* One Stack owns the card's rhythm. Seven `marginTop`s stood here, every one of them
          stating the space BELOW the element above it — which is a property of the column
          and not of any of them, and which had to be remembered again on each new sibling. */}
      <Stack gap="5">
        <Stack gap="2">
          <h2 className="title">What we sent</h2>
          <p className="muted">
            Every message this clinic sent, and what became of it. Phone numbers are shortened on
            purpose — the full number is on the patient&rsquo;s own record.
          </p>
        </Stack>

        <Filters filters={filters} selfPath={selfPath} />

        {page.ok ? (
          <Results page={page.value} filters={filters} selfPath={selfPath} />
        ) : page.status === 403 ? (
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
      </Stack>
    </Card>
  )
}

/**
 * THE SAME BAR THAT SITS ABOVE EVERY LIST IN THIS CONSOLE.
 *
 * It was a bare `row-wrap` of three hand-assembled `.field`/`.select` blocks: no accessible
 * name on the group, so a screen-reader user landing on the first control heard "What became
 * of it, combo box" with nothing to say what it filtered or that two more followed it.
 * `<Toolbar>` gives the group a name — announced, never shown — and `.console-bar` gives it
 * the shape the reconciliation and registry filters already have, so "where the filters are"
 * is something staff learn once rather than once per screen.
 *
 * `<Field>` rather than a `<label>` and a `<select>` typed out beside each other: Field owns
 * the id/htmlFor wiring, which is the part that silently rots when a field is copied to the
 * next screen and its name is changed but its `htmlFor` is not.
 */
function Filters({ filters, selfPath }: { filters: NotificationFilters; selfPath: string }) {
  return (
    <Toolbar
      as="form"
      method="get"
      action={selfPath}
      label="Filter the message log"
      className="console-bar"
      actions={
        <Button type="submit" variant="quiet">
          Filter
        </Button>
      }
    >
      <Field name="status" id="filter-status" label="What became of it">
        {(control) => (
          <Select {...control} defaultValue={filters.status ?? ''}>
            <option value="">Any</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field name="channel" id="filter-channel" label="Channel">
        {(control) => (
          <Select {...control} defaultValue={filters.channel ?? ''}>
            <option value="">Any</option>
            {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {/* A select and not a text box: the catalogue is a closed list, so free text could
          only ever produce a validation error. */}
      <Field name="template_key" id="filter-template" label="Message">
        {(control) => (
          <Select {...control} defaultValue={filters.templateKey ?? ''}>
            <option value="">Any</option>
            {Object.entries(TEMPLATE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Toolbar>
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
  return (
    <>
      {/*
       * THE EMPTY STATE LIVES INSIDE THE TABLE NOW rather than replacing it. Before this an
       * empty result returned early and the whole table went with it — headings, caption and
       * all — so the screen changed shape between a filtered log and an unfiltered one, and
       * the caption's warning about what "sent" does and does not mean never reached the
       * person who had just filtered everything away. That person is the one who most needs
       * to read it, because they are about to conclude a message was never sent.
       *
       * `className="queue"` bounds the scroll region so the column headings stick to its top
       * — see console.css. This log pages at 25 rows and every column but the first is a
       * short value ("delivered to the handset", a masked number); read forty rows down with
       * the headings gone, a delivery timestamp and a failure reason are two dates in two
       * columns nobody can name any more.
       */}
      <DataTable
        className="queue"
        caption="“Sent to the gateway” means the gateway accepted it. Only “delivered to the handset” means it arrived, and only where the gateway reports receipts."
        rows={page.notifications}
        rowKey={(notification) => notification.id}
        empty={
          <EmptyState title="No messages match" icon="mail">
            Nothing was sent under these filters. Clear them to see the whole log.
          </EmptyState>
        }
        columns={[
          {
            key: 'when',
            header: 'When',
            cell: (notification) =>
              notification.created_at === null ? (
                <span className="muted">—</span>
              ) : (
                <DateTime value={notification.created_at} format="datetime" />
              ),
          },
          {
            /* The template NAMES the row: it is what the message WAS, and it is the value an
               administrator is holding when they arrive here asking whether the patient was
               told. A screen reader saying "Appointment reminder, What became of it, Failed"
               is the sentence; the same status read against a timestamp is not. */
            key: 'template',
            header: 'Message',
            rowHeader: true,
            cell: (notification) => templateLabel(notification.template_key),
          },
          {
            key: 'channel',
            header: 'Channel',
            cell: (notification) => channelLabel(notification.channel),
          },
          {
            key: 'recipient',
            header: 'To',
            cell: (notification) => <span className="mono">{notification.recipient}</span>,
          },
          {
            key: 'status',
            header: 'What became of it',
            cell: (notification) => (
              <>
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
              </>
            ),
          },
          {
            key: 'body',
            header: 'What was sent',
            cell: (notification) => notification.body,
          },
        ]}
      />

      <CursorLinks page={page} filters={filters} selfPath={selfPath} />
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
 *
 * NOT `<Pagination>` FROM THE SHARED LAYER, AND THIS IS THE ONE PLACE IN THIS SWEEP THAT
 * REFUSED A PRIMITIVE. That component is cursor-only and would fit the mechanism exactly,
 * but its two controls are labelled "Previous" and "Next" and cannot be relabelled. On a log
 * ordered newest-first those two words are ambiguous in the worst available way — "previous"
 * is either the page you came from or the messages that came before these — and "Newer" and
 * "Older" say which without a reader having to work out the sort order first. Changing the
 * words to adopt the component would have been a copy change made for the convenience of the
 * refactor. If Pagination ever takes its labels as props, this becomes a call site.
 */
function CursorLinks({
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
    <nav aria-label="More messages">
      <Inline gap="4">
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
      </Inline>
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
