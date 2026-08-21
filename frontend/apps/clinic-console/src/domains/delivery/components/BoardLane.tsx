import { Badge, Card, DateTime, EmptyState, Notice } from '@carevelo/ui'
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
      <div className="row-wrap">
        <div className="grow stack">
          <h2 id={headingId}>{definition.heading}</h2>
          <p className="muted">{definition.lede}</p>
        </div>

        {lane.ok ? (
          <Badge tone={lane.value.deliveries.length > 0 ? 'info' : 'neutral'}>
            {lane.value.total} here
          </Badge>
        ) : null}
      </div>

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
      ) : lane.value.deliveries.length === 0 ? (
        <EmptyState title="Nothing here" icon="check">
          {definition.empty}
        </EmptyState>
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

          <div className="table-scroll">
            <table className="table">
              <caption className="muted">
                Oldest first. The delivery that has waited longest is the patient wondering.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">District</th>
                  <th scope="col">State</th>
                  <th scope="col">When</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lane.value.deliveries.map((delivery) => {
                  const status = present(delivery.status)
                  const failed = failureReason(delivery.failure_reason)

                  return (
                    <tr key={delivery.id}>
                      <td>
                        <a href={paths.delivery(delivery.id)} className="lnk">
                          {delivery.reference}
                        </a>
                      </td>
                      <td>{delivery.recipient_name}</td>
                      <td>{delivery.district ?? <span className="muted">Not recorded</span>}</td>
                      <td>
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
                      </td>
                      <td>
                        {delivery.delivered_at ? (
                          <DateTime value={delivery.delivered_at} format="datetime" />
                        ) : delivery.assigned_at ? (
                          <DateTime value={delivery.assigned_at} format="datetime" />
                        ) : (
                          <span className="muted">Not assigned</span>
                        )}
                      </td>
                      <td>
                        <a href={paths.delivery(delivery.id)} className="lnk">
                          Open<span className="sr-only"> delivery {delivery.reference}</span>
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}
