import { Badge, Button, Card, DateTime, Money, Notice } from '@carevelo/ui'
import { attempt } from '../api/http'
import { getOrder } from '../api/queue'
import {
  chooseFulfilment,
  collectOrder,
  decideSubstitution,
  dispenseOrder,
  openOrder,
  priceOrder,
  proposeSubstitution,
  rejectOrder,
} from '../api/actions'
import { present } from '../model/status'
import {
  abilitiesOf,
  controlledItems,
  itemViews,
  mayBeDelivered,
  pendingSubstitutions,
} from '../model/order'
import type { DispenseOrder, DispensingPaths, Viewer } from '../model/types'
import { CorrectionPanel } from './CorrectionPanel'
import { OrderActions } from './OrderActions'
import { PrescriberCard } from './PrescriberCard'
import { PricingForm } from './PricingForm'
import { SubstitutionPanel } from './SubstitutionPanel'

/**
 * One dispense order, in full — the screen a pharmacist works from.
 *
 * ------------------------------------------------------------
 * THIS IS THE ONE PLACE A MEDICINE NAME IS MEANT TO BE READ, and it is behind the policy.
 * `DispenseOrderController::show` records `dispense_order.read` on every call, because "who
 * looked at my records?" can only be answered by having recorded every look. The queue
 * deliberately carries no contents; this screen does, and every visit to it is a line in
 * somebody's access history. Worth remembering before adding a prefetch.
 *
 * ------------------------------------------------------------
 * THE ACTIONS ARE BOUND HERE, ON THE SERVER, WITH THE PATHS THIS DOMAIN WAS MOUNTED AT.
 *
 * This domain hard-codes no URL. A server action needs to know which routes to revalidate
 * after a write — the queue and this order are two routes over one source of truth, and a
 * dispense that refreshed only the order would leave the queue offering work already done.
 * Binding the paths server-side means the values come from the route layer at render time
 * and cannot be supplied by a form field, which is the difference between a revalidation
 * target and something a request can point wherever it likes.
 */
export async function OrderScreen({
  orderId,
  viewer,
  paths,
}: {
  orderId: string
  viewer: Viewer | null
  paths: DispensingPaths
}) {
  const result = await attempt(getOrder(orderId))

  if (!result.ok) {
    /*
     * A CROSS-TENANT OR UNKNOWN ID IS A 404 AND READS AS ONE. The API refuses to confirm
     * that a record exists in another clinic, and this screen must not helpfully explain
     * the difference either — a 403 here would be how you learn that a reference belongs to
     * somebody. `humanise()` has already turned it into "That could not be found."
     */
    return (
      <Notice tone="bad" title="This order could not be opened">
        {result.message
          ?? 'The console could not reach the API. Nothing about this order has changed.'}
      </Notice>
    )
  }

  const order = result.value
  const status = present(order.status)
  const abilities = abilitiesOf(viewer)
  const items = itemViews(order)
  const blocked = pendingSubstitutions(order)
  const deliverable = mayBeDelivered(order)
  const controlled = controlledItems(order)

  /* The two routes that show this order's state. Both are revalidated after every write. */
  const revalidate = [paths.queue, paths.order(order.id)] as const

  const isDispensed = order.dispensed_at !== null

  return (
    <div className="grid">
      <div className="page-head">
        <div className="grow stack">
          <h1>{order.reference}</h1>
          <p>{status.meaning}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {controlled.length > 0 ? (
        /*
         * FIRST ON THE SCREEN, ABOVE EVERYTHING. The pharmacist needs to know this before
         * they price it, not after they have promised the patient a delivery — the API
         * refuses at the counter for the same reason, so the patient is told while they are
         * still standing there rather than after they have gone home to wait.
         */
        <Notice tone="bad" title="Contains a controlled medicine — in-person handling only">
          {controlled.map((item) => item.medicine_name).join(', ')}
          {controlled.length === 1 ? ' is' : ' are'} flagged controlled. Under the NDPA Act
          Cap 206 this order cannot enter the delivery flow at all, and the system offers no
          way to override that. Either hand the controlled items over in person and dispatch
          the remainder as a separate order, or record this one as collection-only.
        </Notice>
      ) : null}

      {order.rejection_reason ? (
        <Notice tone="bad" title="The pharmacy declined this order">
          {order.rejection_reason}
        </Notice>
      ) : null}

      <div className="grid g-2">
        <Card as="section" aria-labelledby="totals">
          <div className="stack">
            <h2 id="totals">Total</h2>

            <dl className="stack">
              <div className="row">
                <dt className="grow muted">Medicines</dt>
                <dd className="tnum">
                  <Money value={order.subtotal} />
                </dd>
              </div>
              <div className="row">
                <dt className="grow muted">Delivery</dt>
                <dd className="tnum">
                  <Money value={order.delivery_fee} />
                </dd>
              </div>
              <div className="row">
                <dt className="grow">
                  <strong>To pay</strong>
                </dt>
                <dd className="tnum">
                  <strong>
                    <Money value={order.total} />
                  </strong>
                </dd>
              </div>
            </dl>

            <p className="muted">
              The clinic&rsquo;s own prices. Payment settles to the clinic&rsquo;s own account —
              Carevelo holds none of it and takes no margin on a medicine.
            </p>
          </div>
        </Card>

        <Card as="section" aria-labelledby="handover">
          <div className="stack">
            <h2 id="handover">Handover</h2>

            <dl className="stack">
              <div className="row">
                <dt className="grow muted">Method</dt>
                <dd>
                  {order.fulfilment === 'delivery'
                    ? 'Delivery'
                    : order.fulfilment === 'pickup'
                      ? 'Collection at the pharmacy'
                      : 'Not chosen yet'}
                </dd>
              </div>
              <div className="row">
                <dt className="grow muted">Dispensed</dt>
                <dd>
                  {order.dispensed_at ? (
                    <DateTime value={order.dispensed_at} format="datetime" />
                  ) : (
                    <span className="muted">Not yet</span>
                  )}
                </dd>
              </div>
            </dl>

            {order.fulfilment === 'delivery' && isDispensed ? (
              <div>
                {/*
                 * A LINK, NOT A FORM. Creating the delivery belongs to the delivery domain
                 * and to the dispatcher, and the recipient details it needs are confirmed
                 * with the patient at the point of dispatch. The route layer decides where
                 * that screen lives; this domain only knows it exists.
                 */}
                <Button href={paths.newDelivery(order.id)} variant="quiet">
                  Send this to dispatch
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      {order.prescription ? (
        <PrescriberCard prescription={order.prescription} />
      ) : (
        <Notice tone="warn" title="The prescription did not come back with this order">
          Without it there is nothing to check the dispensed items against, and this console
          cannot tell whether the order holds a controlled medicine — so delivery is not
          offered. Reload before working this order.
        </Notice>
      )}

      <SubstitutionPanel
        orderId={order.id}
        items={items}
        mayPropose={abilities.proposesSubstitutions && !isDispensed}
        mayDecide={abilities.decidesSubstitutions}
        propose={proposeSubstitution.bind(null, revalidate)}
        decide={decideSubstitution.bind(null, revalidate)}
      />

      {abilities.worksTheBench && !isDispensed ? (
        <PricingForm
          orderId={order.id}
          items={items}
          deliveryFeeMinor={order.delivery_fee.amount_minor}
          action={priceOrder.bind(null, revalidate)}
        />
      ) : null}

      {isDispensed ? <DispensedLines order={order} /> : null}

      <OrderActions
        orderId={order.id}
        status={order.status}
        fulfilment={order.fulfilment}
        mayWorkTheBench={abilities.worksTheBench}
        mayDispense={abilities.dispenses}
        mayBeDelivered={deliverable}
        blockingSubstitutions={blocked.length}
        open={openOrder.bind(null, revalidate)}
        dispense={dispenseOrder.bind(null, revalidate)}
        chooseFulfilment={chooseFulfilment.bind(null, revalidate)}
        collect={collectOrder.bind(null, revalidate)}
        reject={rejectOrder.bind(null, revalidate)}
      />

      {isDispensed ? <CorrectionPanel /> : null}
    </div>
  )
}

/**
 * What was actually handed over, once it has been.
 *
 * READ-ONLY, AND PERMANENTLY SO. The pricing form disappears the moment `dispensed_at` is
 * set and this table takes its place. A dispensed line is a record of what physically
 * changed hands; see CorrectionPanel for why nothing on this screen edits one.
 *
 * Unfulfilled lines are listed with their reasons rather than filtered out — the whole
 * point of recording an unfilled item is that the clinician can see later which medicine
 * the patient never received instead of finding a silent gap.
 */
function DispensedLines({ order }: { order: DispenseOrder }) {
  const lines = order.items ?? []

  return (
    <Card as="section" aria-labelledby="dispensed">
      <div className="stack">
        <h2 id="dispensed">What was dispensed</h2>

        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="tnum">Quantity</th>
                <th scope="col" className="tnum">Unit price</th>
                <th scope="col">Filled</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.medicine_name_dispensed}
                    {line.substitution_id ? (
                      <>
                        {' '}
                        {/* Traceable back to the clinician who allowed it, which is the
                            reason the column exists on the resource at all. */}
                        <Badge tone="info">Approved substitute</Badge>
                      </>
                    ) : null}
                  </td>
                  <td className="tnum">{line.quantity_dispensed}</td>
                  <td className="tnum">
                    <Money value={line.unit_price} />
                  </td>
                  <td>
                    {line.is_fulfilled ? (
                      <Badge tone="good">Filled</Badge>
                    ) : (
                      <span>
                        <Badge tone="warn">Not filled</Badge>{' '}
                        <span className="muted">{line.unfulfilled_reason}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  )
}
