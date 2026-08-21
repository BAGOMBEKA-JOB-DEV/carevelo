import { Badge, Button, Card, EmptyState, Money, Notice } from '@carevelo/ui'
import type { DispenseOrder } from '@/domains/dispensing'
import type { Attempt } from '../api/http'
import type { DispatchPaths } from '../model/types'

/**
 * Dispensed orders that have not been sent out yet.
 *
 * ------------------------------------------------------------
 * THIS IS THE ONE PLACE THE DISPATCH BOARD LOOKS AT A DISPENSE ORDER, AND IT LOOKS AT IT AS
 * A REFERENCE ONLY.
 *
 * A reference, a total, and a link back to the order for somebody who is allowed to open
 * it. No items, no medicine names, no patient name — the queue endpoint does not load the
 * prescription, so the contents are not even in the payload the route fetched. A dispatcher
 * does not need to know what is in the package to send it, and the smallest amount of
 * clinical data on a screen that is on all day is none.
 *
 * ------------------------------------------------------------
 * THE ORDERS ARRIVE AS A PROP, FROM THE ROUTE, AND THAT IS THE BOUNDARY WORKING.
 *
 * `listLane('dispensed')` belongs to the dispensing domain. This domain does not call it —
 * cross-domain composition belongs in the route layer, which is what `src/app` is for — so
 * `app/dispatch/page.tsx` fetches both halves and hands each screen its own. The only thing
 * crossing the boundary here is a TYPE from the dispensing domain's public surface, which
 * is exactly what a public surface is for.
 *
 * ------------------------------------------------------------
 * AN ORDER SITTING HERE WITH NO RIDER IS NOT AN ERROR STATE.
 *
 * The PRD's exception table: "No rider available — order holds at `dispensed`; the patient
 * is told and offered pickup." So a full lane here means somebody should be ringing
 * patients, not that the software is stuck. The notice says so, because a dispatcher who
 * reads this as a backlog waits for it to clear on its own.
 *
 * ------------------------------------------------------------
 * WHY THE FULFILMENT METHOD IS A COLUMN AND NOT A FILTER.
 *
 * What arrives is every order in `dispensed`. An order whose delivery has been created has
 * already moved to `out_for_delivery`, so everything in this list genuinely still needs
 * something — but not all of it needs DISPATCH. An order set for collection is on the
 * pharmacy's shelf; an order with no method chosen is waiting on the patient to say.
 *
 * Filtering those out would be tidier and would hide the two states somebody has to act on.
 * A dispatcher looking at a short list and a long one wants to know which of them are
 * theirs, and which are stuck for a reason that is not "no rider". So the method is shown
 * and the button appears only where creating a delivery is actually the next step.
 */
export function AwaitingDispatch({
  orders,
  mayDispatch,
  paths,
}: {
  orders: Attempt<readonly DispenseOrder[]>
  mayDispatch: boolean
  paths: DispatchPaths
}) {
  return (
    <Card as="section" aria-labelledby="awaiting">
      <div className="row-wrap">
        <div className="grow stack">
          <h2 id="awaiting">Waiting to go out</h2>
          <p className="muted">
            Every order that has been dispensed and has not left the pharmacy. Creating a
            delivery is what puts an address in front of a rider, and it is only the next step
            for the ones the patient asked to have delivered.
          </p>
        </div>

        {orders.ok ? (
          <Badge tone={orders.value.length > 0 ? 'warn' : 'neutral'}>
            {orders.value.length} waiting
          </Badge>
        ) : null}
      </div>

      {!orders.ok ? (
        <Notice tone="bad" title="This list did not load">
          {orders.message
            ?? 'The console could not reach the API. Deliveries already created are shown '
              + 'below and are unaffected.'}
        </Notice>
      ) : orders.value.length === 0 ? (
        <EmptyState title="Nothing waiting" icon="check">
          Every dispensed order has either left the pharmacy or been collected.
        </EmptyState>
      ) : (
        <>
          <Notice tone="info" title="An order holding here is not stuck software">
            With no rider available an order simply holds at dispensed, and the patient
            should be told and offered collection rather than left waiting on a delivery that
            was never going to happen.
          </Notice>

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">The patient asked for</th>
                  <th scope="col" className="tnum">Total</th>
                  <th scope="col">
                    <span className="sr-only">Dispatch</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.value.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <a href={paths.order(order.id)} className="lnk">
                        {order.reference}
                      </a>
                    </td>
                    <td>
                      {order.fulfilment === 'delivery' ? (
                        <Badge tone="info">Delivery</Badge>
                      ) : order.fulfilment === 'pickup' ? (
                        <Badge tone="neutral">Collection</Badge>
                      ) : (
                        <Badge tone="warn">Not chosen</Badge>
                      )}
                    </td>
                    <td className="tnum">
                      <Money value={order.total} />
                    </td>
                    <td>
                      {order.fulfilment !== 'delivery' ? (
                        /*
                         * Deliberately not a disabled button. Dispatch is not the next step
                         * here and pressing anything would be wrong: an order set for
                         * collection is on the shelf, and one with no method chosen is
                         * waiting on the patient — which the pharmacy records, not dispatch.
                         */
                        <span className="muted">
                          {order.fulfilment === 'pickup'
                            ? 'On the shelf for collection'
                            : 'Waiting on the patient to choose'}
                        </span>
                      ) : mayDispatch ? (
                        <Button href={paths.newDelivery(order.id)} variant="quiet">
                          Create delivery
                          <span className="sr-only"> for order {order.reference}</span>
                        </Button>
                      ) : (
                        <span className="muted">Dispatcher or administrator only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}
