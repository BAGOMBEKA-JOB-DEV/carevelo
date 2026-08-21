import { Badge, Card, DateTime, EmptyState, Money, Notice } from '@carevelo/ui'
import { present } from '../model/status'
import type { Lane } from '../api/queue'
import { MAX_PER_PAGE } from '../api/queue'
import type { Attempt } from '../api/http'
import type { DispensingPaths } from '../model/types'
import type { Lane as LaneDefinition } from '../model/status'

/**
 * One status lane of the pharmacy queue.
 *
 * ------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT ON THIS SCREEN: MEDICINE NAMES.
 *
 * `GET /v1/dispense-orders` does not load the prescription relation, so the contents are
 * not in the payload — and the API's own comment says why: "A pharmacist scanning for work
 * does not need the contents, and this list is the most-displayed screen in the pharmacy."
 * The queue is references, states, totals and how long each has waited. The one place a
 * medicine name is meant to be read is the order itself, behind the policy, where the read
 * is audited.
 *
 * Which is worth defending when somebody asks for the drug name in the list. A pharmacy
 * counter is overlooked by whoever is next in the queue, and this board is on screen all
 * day.
 *
 * ------------------------------------------------------------
 * THERE IS NO PAGER, AND THAT IS THE DESIGN.
 *
 * See api/queue.ts. `GET /v1/dispense-orders` pages by offset, the house rule is cursor,
 * and an offset over a table being written to is how a live queue loses a row. So the lane
 * makes one bounded request and, if the clinic has more waiting in this state than one
 * request carries, SAYS SO rather than showing the oldest hundred as though that were all
 * of them. Truncating in silence is the failure mode we are avoiding; truncating out loud
 * is merely inconvenient.
 */
export function QueueLane({
  definition,
  lane,
  paths,
}: {
  definition: LaneDefinition
  lane: Attempt<Lane>
  paths: DispensingPaths
}) {
  const headingId = `lane-${definition.status}`

  return (
    <Card as="section" aria-labelledby={headingId}>
      <div className="row-wrap">
        <div className="grow stack">
          <h2 id={headingId}>{definition.heading}</h2>
          <p className="muted">{definition.lede}</p>
        </div>

        {/* The count as a word beside a number, not a bare badge: "4" alone next to a
            heading is ambiguous between "four waiting" and "four of something else". */}
        {lane.ok ? (
          <Badge tone={lane.value.orders.length > 0 ? 'info' : 'neutral'}>
            {lane.value.total} waiting
          </Badge>
        ) : null}
      </div>

      {!lane.ok ? (
        /*
         * ONE LANE FAILING MUST NOT TAKE THE BENCH DOWN. This renders in place of the
         * table and the other four lanes carry on — a pharmacist with a patient at the
         * counter needs whatever the screen can still show. `attempt()` supplies the API's
         * own sentence where there is one; where the request never arrived there is
         * nothing to pass on and inventing detail about a failure we did not observe is
         * how a support call starts.
         */
        <Notice tone="bad" title="This lane did not load">
          {lane.message
            ?? 'The console could not reach the API. The other lanes may still be current; '
              + 'this one is not, and it will try again on its own.'}
        </Notice>
      ) : lane.value.orders.length === 0 ? (
        <EmptyState title="Nothing here" icon="check">
          {definition.empty}
        </EmptyState>
      ) : (
        <>
          {lane.value.overflowed ? (
            <Notice tone="warn" title="More than this screen shows">
              {lane.value.total} orders are in this state and this list holds the {MAX_PER_PAGE}{' '}
              that have waited longest. There is no next page on a live queue on purpose —
              paging by position while orders are arriving is how one gets skipped. Work
              these off and the rest appear.
            </Notice>
          ) : null}

          <div className="table-scroll">
            <table className="table">
              <caption className="muted">
                Oldest first. The order that has waited longest is the patient wondering.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">State</th>
                  <th scope="col">Arrived</th>
                  <th scope="col" className="tnum">Total</th>
                  <th scope="col">
                    {/* A header for the action column: an empty <th> is announced as
                        nothing at all, which leaves a screen-reader user without a name
                        for the column they have just landed in. */}
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lane.value.orders.map((order) => {
                  const status = present(order.status)

                  return (
                    <tr key={order.id}>
                      <td>
                        <a href={paths.order(order.id)} className="lnk">
                          {order.reference}
                        </a>
                      </td>
                      <td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td>
                        {/*
                         * `dispensed_at` is the only instant on this resource, and it is
                         * null for everything in an actionable lane. So the column shows
                         * it where it exists and says so plainly where it does not,
                         * rather than inventing an arrival time the API never sent.
                         */}
                        {order.dispensed_at ? (
                          <DateTime value={order.dispensed_at} format="datetime" />
                        ) : (
                          <span className="muted">In the queue</span>
                        )}
                      </td>
                      <td className="tnum">
                        <Money value={order.total} />
                      </td>
                      <td>
                        <a href={paths.order(order.id)} className="lnk">
                          Open<span className="sr-only"> order {order.reference}</span>
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
