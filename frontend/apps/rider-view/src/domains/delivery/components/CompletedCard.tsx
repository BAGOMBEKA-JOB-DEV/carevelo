import { Button, Card, Icon, Inline, Stack } from '@carevelo/ui'
import { deliveryHref } from '../model/links'
import type { DeliveryPaths, RiderDelivery } from '../model/types'
import { DeliveryStatusBadge } from './DeliveryStatusBadge'

/**
 * One delivery the rider has already finished.
 *
 * ------------------------------------------------------------
 * IT IS A SEPARATE CARD FROM `AssignmentCard`, AND THE DIFFERENCE IS ONE BUTTON
 *
 * The two carry the same four fields — there is nothing else on `RiderDeliveryResource` to
 * carry — but the finished card has NO "call the recipient" control, and its absence is the
 * whole reason this file exists rather than a `variant` prop on the other one.
 *
 * A `tel:` link on a live assignment is the rider standing at a gate that will not open. A
 * `tel:` link on a delivery that was handed over yesterday is a one-tap route from a
 * finished job to an unsolicited telephone call to a patient, from a personal handset, for
 * a reason nobody has recorded. The number is still on the row because the server sends it
 * and because a rider checking a disputed drop needs to know which number they rang — but
 * it is not a target any more. Making that a boolean prop would put "may this rider ring
 * this patient" one careless `true` away from being wrong, which is the same argument
 * `RiderDeliveryResource` makes about hidden fields versus absent ones.
 *
 * ------------------------------------------------------------
 * THE STATUS IS THE POINT OF THE CARD
 *
 * Three outcomes end up here — delivered, could not be delivered, returned to the pharmacy
 * — and the difference between them is the reason a rider opens this screen at all: to
 * check their own day against the clinic's record of it. So the badge is on the first line
 * beside the reference, at reading size, with a word in it and not only a colour.
 * `DeliveryStatusBadge` carries that argument; on this surface it is sharpened by the fact
 * that "Could not be delivered" and "Delivered" must never be told apart by hue alone,
 * outdoors, through a visor.
 *
 * ------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT ON IT
 *
 * `failure_reason`. It is on the delivery's own screen, which the rider recorded it on and
 * can open from here. In a LIST it is a one-line statement about a household — "refused",
 * "recipient unreachable" — legible to anybody who picks the phone up, and this handset
 * leaves the clinic every evening. The same reasoning keeps it off the PATIENT's list, in
 * `PatientDeliveryResource`, one audience over.
 *
 * And a delivery time. `RiderDeliveryResource` publishes no timestamp, so there is none to
 * show, and the honest consequence is that this screen says WHAT happened rather than WHEN.
 * That is a real limitation: a rider checking a disputed drop wants the hour. Adding
 * `delivered_at` to the resource is a small and defensible disclosure decision — it is the
 * rider's own working record and names nothing clinical — but it is a decision about a
 * shared resource class that serves three screens, and it belongs on the server with the
 * rest of that class's argument rather than being inferred here from an ordering.
 */
export function CompletedCard({
  delivery,
  paths,
}: {
  delivery: RiderDelivery
  paths: DeliveryPaths
}) {
  const href = deliveryHref(paths, delivery.id)

  return (
    <Card as="li">
      <Stack gap="4">
        <Inline gap="3" justify="between">
          {/* `.rider-ref` rather than `.eyebrow`: ink at reading size, 15.78:1 against the
              canvas where the eyebrow measured 3.02:1. See AssignmentCard and rider.css —
              this is a screen read outdoors, in direct sun, through a visor. */}
          <span className="rider-ref grow">{delivery.reference}</span>
          <DeliveryStatusBadge status={delivery.status} />
        </Inline>

        <h2>{delivery.recipient_name}</h2>

        {/* The address as one block of ordinary prose rather than a labelled table, exactly
            as the round shows it — a rider matching a row against their memory of the day
            reads it the way they read it off a note. */}
        <p className="muted">
          {delivery.address_text}
          {delivery.landmark ? <> &middot; {delivery.landmark}</> : null}
          {delivery.district ? <> &middot; {delivery.district}</> : null}
        </p>

        {/*
          A full-width target, and the only one on the card. A plain anchor rather than
          next/link, because every navigation on this surface is a document load already and
          prefetching a finished delivery a rider has not opened spends their data bundle on
          a screen they will probably never look at.

          THE ACCESSIBLE NAME CARRIES THE REFERENCE AND THE VISIBLE LABEL DOES NOT. A
          screen-reader user pulling up the links on this page would otherwise hear "Open,
          Open, Open" — identical names for different deliveries, which is precisely the
          case WCAG's link-purpose requirement exists for. The visible word stays short
          because the card around it already says which delivery it is to anybody who can
          see it.
        */}
        <Button
          href={href}
          variant="quiet"
          block
          aria-label={`Open delivery ${delivery.reference} for ${delivery.recipient_name}`}
        >
          Open
          <Icon name="chevRight" />
        </Button>
      </Stack>
    </Card>
  )
}
