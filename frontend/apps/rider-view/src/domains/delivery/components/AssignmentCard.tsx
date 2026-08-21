import { Button, Card, Icon } from '@carevelo/ui'
import { deliveryHref } from '../model/links'
import type { DeliveryPaths, RiderDelivery } from '../model/types'
import { CallRecipient } from './CallRecipient'
import { DeliveryStatusBadge } from './DeliveryStatusBadge'

/**
 * One assignment, in the list.
 *
 * ------------------------------------------------------------
 * EVERY FIELD ON THIS CARD IS ONE OF THE FOUR A RIDER MAY HAVE
 *
 * Recipient name, recipient phone, delivery address, package reference. There is nothing
 * else to add here, and the reason there is nothing else is not restraint on this card's
 * part — `RiderDeliveryResource` has no other field on it. If a future change makes this
 * card look thin, the thing to resist is a request to "just include what is being
 * delivered": that is the exact erosion the rider rule is written to prevent, and the
 * server would have to be changed first, which is where the argument belongs.
 *
 * ------------------------------------------------------------
 * THE WHOLE CARD IS NOT A LINK, AND THE CALL BUTTON IS NOT INSIDE ONE
 *
 * Two targets, side by side, both large: open the delivery, or ring the recipient. A
 * card-wide link with a button nested in it is invalid markup, and it behaves exactly as
 * badly as that suggests on a phone — the wrong one fires under a thumb that lands a few
 * pixels off, and on this surface the wrong one is a telephone call to a patient.
 *
 * THE REFERENCE IS FIRST AND IN TABULAR FIGURES. It is what the rider reads aloud to the
 * pharmacist at the counter, and what they match against the label on the package. It is
 * also, deliberately, the only thing that identifies the CONTENTS — a reference names a
 * package without describing it.
 */
export function AssignmentCard({
  delivery,
  paths,
}: {
  delivery: RiderDelivery
  paths: DeliveryPaths
}) {
  const href = deliveryHref(paths, delivery.id)

  return (
    <Card as="li" className="stack">
      <div className="row-wrap">
        <span className="eyebrow tnum grow">{delivery.reference}</span>
        <DeliveryStatusBadge status={delivery.status} />
      </div>

      <h3>{delivery.recipient_name}</h3>

      {/* The address as one block of ordinary prose rather than a labelled table. A rider
          reads it the way they would read it off a note: street, landmark, district. */}
      <p className="muted">
        {delivery.address_text}
        {delivery.landmark ? <> &middot; {delivery.landmark}</> : null}
        {delivery.district ? <> &middot; {delivery.district}</> : null}
      </p>

      <div className="row-wrap">
        <CallRecipient name={delivery.recipient_name} phone={delivery.recipient_phone} />

        {/*
          A plain anchor, not next/link. Every navigation on this surface is a document
          load already — the tab bar in FieldShell is built from anchors for the same
          reason — and prefetching a delivery a rider has not opened spends their data
          bundle on a screen they may never look at.
        */}
        <Button href={href} variant="quiet" className="grow">
          Open
          <Icon name="chev" />
        </Button>
      </div>
    </Card>
  )
}
