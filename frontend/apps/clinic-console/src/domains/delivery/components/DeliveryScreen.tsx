import { Badge, Card, DateTime, Notice } from '@carevelo/ui'
import { attempt } from '../api/http'
import { abilitiesOf, getDelivery, getTracking, listRiders } from '../api/deliveries'
import { assignRider } from '../api/actions'
import { failureReason, present } from '../model/status'
import type { DispatchPaths, Staff, Viewer } from '../model/types'
import { AssignRiderForm } from './AssignRiderForm'

/**
 * One delivery, in full — the record a dispatcher works from.
 *
 * ------------------------------------------------------------
 * THIS SCREEN SHOWS EXACTLY WHAT THE RIDER WILL SEE, AND SAYS SO.
 *
 * The PRD: "this screen shows the dispatcher exactly what the rider will be able to see
 * before they assign it." That is the point of the recipient block below — not to give the
 * dispatcher a contact card, but to let them check, before an address leaves the clinic,
 * that what is about to leave is right and is only this.
 *
 * ------------------------------------------------------------
 * THE DISPENSE ORDER IS A REFERENCE ONLY, HERE AS EVERYWHERE ON THIS SURFACE.
 *
 * There is a link back to it for somebody who is allowed to open it, and nothing else. No
 * contents, no totals, no patient record. `DeliveryResource` carries a `dispense_order_id`
 * and this screen treats it as what it is: a way to get back, not a way to see in.
 *
 * ------------------------------------------------------------
 * THREE READS, IN PARALLEL, EACH ALLOWED TO FAIL ON ITS OWN.
 *
 * The delivery itself, the tracking thread, and the rider list. The rider list failing is
 * the ORDINARY case rather than an error — see `listRiders()` — and the tracking thread
 * failing must not stop somebody assigning a rider, which is the thing on this page that
 * actually moves medicine.
 */
export async function DeliveryScreen({
  deliveryId,
  viewer,
  paths,
}: {
  deliveryId: string
  viewer: Viewer | null
  paths: DispatchPaths
}) {
  const abilities = abilitiesOf(viewer)

  const [record, tracking, riders] = await Promise.all([
    attempt(getDelivery(deliveryId)),
    attempt(getTracking(deliveryId)),
    abilities.assignsRiders ? attempt(listRiders()) : Promise.resolve(null),
  ])

  if (!record.ok) {
    /*
     * A CROSS-TENANT OR UNKNOWN ID IS A 404 AND READS AS ONE. The API deliberately refuses
     * to confirm that a record exists in another clinic, and this screen does not explain
     * the difference either — a 403 here is how you learn that a reference belongs to
     * somebody.
     */
    return (
      <Notice tone="bad" title="This delivery could not be opened">
        {record.message
          ?? 'The console could not reach the API. Nothing about this delivery has changed.'}
      </Notice>
    )
  }

  const delivery = record.value
  const status = present(delivery.status)
  const failed = failureReason(delivery.failure_reason)

  const revalidate = [paths.board, paths.delivery(delivery.id)] as const

  /*
   * `null` from `listRiders()` means "you may not list staff", and the form turns into a
   * typed identifier. A FAILED read is different and is treated as the same thing here on
   * purpose: whatever the cause, there are no names to offer, and a dispatcher who can type
   * the identifier can still get the package moving. Refusing to render the form because a
   * picker would not populate would be the software blocking a dispatch over a convenience.
   */
  const riderList: Staff[] | null = riders !== null && riders.ok ? riders.value : null

  return (
    <div className="grid">
      <div className="page-head">
        <div className="grow stack">
          <h1>{delivery.reference}</h1>
          <p>{status.meaning}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {failed ? (
        <Notice tone="bad" title="This delivery failed">
          {failed}. The medicine returns to the licensed premises — it never sits with a
          rider overnight. The patient is owed a reschedule or a refund, and a refund is
          executed by the clinic through its own aggregator: Carevelo holds nothing to refund
          from, and the state exists to make the obligation visible rather than to discharge
          it.
        </Notice>
      ) : null}

      <div className="grid g-2">
        <Card as="section" aria-labelledby="recipient">
          <div className="stack">
            <h2 id="recipient">What the rider sees</h2>

            <dl className="stack">
              <div className="stack">
                <dt className="stat__label">Recipient</dt>
                <dd>{delivery.recipient_name}</dd>
              </div>
              <div className="stack">
                <dt className="stat__label">Telephone</dt>
                <dd className="tnum">{delivery.recipient_phone}</dd>
              </div>
              <div className="stack">
                <dt className="stat__label">Address</dt>
                <dd>{delivery.address_text}</dd>
              </div>
              <div className="stack">
                <dt className="stat__label">District</dt>
                <dd>{delivery.district ?? <span className="muted">Not recorded</span>}</dd>
              </div>
              <div className="stack">
                <dt className="stat__label">Landmark</dt>
                <dd>{delivery.landmark ?? <span className="muted">Not recorded</span>}</dd>
              </div>
              <div className="stack">
                <dt className="stat__label">Package reference</dt>
                <dd className="tnum">{delivery.reference}</dd>
              </div>
            </dl>

            <p className="muted">
              That is the whole of it. No diagnosis, no clinical note, no prescription
              detail — the rider&rsquo;s surface uses a separate resource class with no such
              fields, and an explicit test covers it.
            </p>
          </div>
        </Card>

        <Card as="section" aria-labelledby="timeline">
          <div className="stack">
            <h2 id="timeline">What the patient is being told</h2>

            {!tracking.ok ? (
              <Notice tone="warn" title="The tracking thread did not load">
                {tracking.message
                  ?? 'The console could not reach the API. Everything else on this page is '
                    + 'current and assignment is unaffected.'}
              </Notice>
            ) : (
              <>
                <ol className="stack">
                  {tracking.value.milestones.length === 0 ? (
                    <li className="muted">No milestones yet.</li>
                  ) : (
                    tracking.value.milestones.map((milestone, index) => (
                      // The API returns an ordered list of status strings; there is no
                      // identifier on a milestone, so the position IS the identity and the
                      // list is append-only. A key of the value alone would collide the
                      // moment a delivery is reassigned and passes through a state twice.
                      <li key={`${milestone}-${index}`}>{present(milestone).label}</li>
                    ))
                  )}
                </ol>

                <p className="muted">
                  Status milestones and nothing else. The patient is never told what is in
                  the package, and neither are they told which medicine — a tracking page is
                  read on shared handsets and over shoulders.
                </p>
              </>
            )}

            <dl className="stack">
              <div className="row">
                <dt className="grow muted">Assigned</dt>
                <dd>
                  {delivery.assigned_at ? (
                    <DateTime value={delivery.assigned_at} format="datetime" />
                  ) : (
                    <span className="muted">Not yet</span>
                  )}
                </dd>
              </div>
              <div className="row">
                <dt className="grow muted">Delivered</dt>
                <dd>
                  {delivery.delivered_at ? (
                    <DateTime value={delivery.delivered_at} format="datetime" />
                  ) : (
                    <span className="muted">Not yet</span>
                  )}
                </dd>
              </div>
              <div className="row">
                <dt className="grow muted">Dispense order</dt>
                <dd>
                  <a className="lnk" href={paths.order(delivery.dispense_order_id)}>
                    Open the order
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </Card>
      </div>

      <AssignRiderForm
        deliveryId={delivery.id}
        currentRiderId={delivery.rider_id}
        riders={riderList}
        mayAssign={abilities.assignsRiders}
        action={assignRider.bind(null, revalidate)}
      />

      {/*
       * WHY THERE IS NO "MARK AS FAILED" CONTROL ON THIS PAGE, and why that is not an
       * omission. A failure is recorded by the RIDER, through the most restricted
       * permission in the system — `DeliveryPolicy::updateStatus` admits only the rider the
       * delivery is assigned to. There is no dispatcher endpoint that writes one, and there
       * should not be: the person who stood at the door is the person who knows what
       * happened there. A dispatcher who disagrees resolves it by telephone and a
       * reassignment, both of which stay in the history.
       */}
      <Notice tone="info" title="Statuses come from the rider">
        Picked up, on the way, delivered and failed are all recorded by the rider carrying
        the package, on their own surface. A rider who has gone unreachable is handled by
        reassigning above — the original assignment stays in this delivery&rsquo;s history
        rather than being overwritten.
      </Notice>
    </div>
  )
}
