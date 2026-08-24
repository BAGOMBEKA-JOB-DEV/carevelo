import { Badge, Card, DataTable, DateTime, EmptyState, Inline, Notice, Stack } from '@carevelo/ui'
import { failureReason, present } from '../model/status'
import { MAX_PER_PAGE, type Lane } from '../api/deliveries'
import type { Attempt } from '../api/http'
import type { DispatchPaths } from '../model/types'
import type { Lane as LaneDefinition } from '../model/status'

/**
 * One status lane of the dispatch board.
 *
 * ------------------------------------------------------------
 * WHAT IS ON THIS BOARD, AND WHAT COULD NEVER BE.
 *
 * A reference, a recipient, a district, a status and a time. `DeliveryResource` carries no
 * medicine, no item list and no clinical note — there is no field on it that could. The
 * dispatcher's job is to get a package to a door, and the package's contents are not part
 * of that job.
 *
 * The recipient's full address and telephone number are NOT in this table either, though
 * they are on the resource. They belong on the record, one click away, where somebody who
 * needs them goes deliberately — a board is on screen all day in a room people walk
 * through, and a column of home addresses is a disclosure surface nobody chose.
 *
 * ------------------------------------------------------------
 * THERE IS NO PAGER, AND THAT IS THE DESIGN. See api/deliveries.ts: the endpoint pages by
 * offset, the house rule is cursor, and an offset over a table being written to is how a
 * live board loses a row. One bounded request per lane, and an overflow said out loud
 * rather than truncated in silence.
 */
export function BoardLane({
  definition,
  lane,
  paths,
}: {
  definition: LaneDefinition
  lane: Attempt<Lane>
  paths: DispatchPaths
}) {
  const headingId = `lane-${definition.status}`

  return (
    <Card as="section" aria-labelledby={headingId}>
      <Inline>
        <Stack className="grow" gap="2">
          <h2 id={headingId}>{definition.heading}</h2>
          <p className="muted">{definition.lede}</p>
        </Stack>

        {lane.ok ? (
          <Badge tone={lane.value.deliveries.length > 0 ? 'info' : 'neutral'}>
            {lane.value.total} here
          </Badge>
        ) : null}
      </Inline>

      {!lane.ok ? (
        /*
         * ONE LANE FAILING MUST NOT TAKE THE BOARD DOWN. The other five carry on. A
         * dispatcher with a rider on the telephone needs whatever the screen can still
         * show, and "nothing blocks a dispensing action" is an acceptance criterion that
         * this screen inherits.
         */
        <Notice tone="bad" title="This lane did not load">
          {lane.message
            ?? 'The console could not reach the API. The other lanes may still be current; '
              + 'this one is not, and it will try again on its own.'}
        </Notice>
      ) : (
        <>
          {lane.value.overflowed ? (
            <Notice tone="warn" title="More than this screen shows">
              {lane.value.total} deliveries are in this state and this list holds the{' '}
              {MAX_PER_PAGE} that have waited longest. There is no next page on a live board
              on purpose — paging by position while deliveries are being created and
              reassigned is how one gets skipped.
            </Notice>
          ) : null}

          {/* `className="queue"` bounds the scroll region so the column headings can stick
              to something. See console.css rule 6: a dispatcher reading down a lane of forty
              references with "Recipient" and "District" scrolled off the top is counting
              columns instead of reading them. */}
          <DataTable
            className="queue"
            caption="Oldest first. The delivery that has waited longest is the patient wondering."
            rows={lane.value.deliveries}
            rowKey={(delivery) => delivery.id}
            empty={
              <EmptyState title="Nothing here" icon="check">
                {definition.empty}
              </EmptyState>
            }
            columns={[
              {
                key: 'reference',
                header: 'Reference',
                rowHeader: true,
                cell: (delivery) => (
                  <a href={paths.delivery(delivery.id)} className="lnk">
                    {delivery.reference}
                  </a>
                ),
              },
              { key: 'recipient', header: 'Recipient', cell: (delivery) => delivery.recipient_name },
              {
                key: 'district',
                header: 'District',
                cell: (delivery) =>
                  delivery.district ?? <span className="muted">Not recorded</span>,
              },
              {
                key: 'state',
                header: 'State',
                cell: (delivery) => {
                  const status = present(delivery.status)
                  const failed = failureReason(delivery.failure_reason)

                  return (
                    <>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {failed ? (
                        <>
                          {' '}
                          {/* The reason, in English, from the fixed list. A dispatcher
                              deciding whether to send it out again needs to know whether
                              the address was wrong or the recipient simply out. */}
                          <span className="muted">{failed}</span>
                        </>
                      ) : null}
                    </>
                  )
                },
              },
              {
                key: 'when',
                header: 'When',
                cell: (delivery) =>
                  delivery.delivered_at ? (
                    <DateTime value={delivery.delivered_at} format="datetime" />
                  ) : delivery.assigned_at ? (
                    <DateTime value={delivery.assigned_at} format="datetime" />
                  ) : (
                    <span className="muted">Not assigned</span>
                  ),
              },
              {
                key: 'open',
                header: 'Open delivery',
                headerHidden: true,
                cell: (delivery) => (
                  <a href={paths.delivery(delivery.id)} className="lnk">
                    Open<span className="sr-only"> delivery {delivery.reference}</span>
                  </a>
                ),
              },
            ]}
          />
        </>
      )}
    </Card>
  )
}
