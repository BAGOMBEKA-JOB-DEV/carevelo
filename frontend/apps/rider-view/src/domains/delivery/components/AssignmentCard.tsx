import { Button, Card, Icon, Inline, Stack } from '@carevelo/ui'
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
 * ------------------------------------------------------------
 * THE REFERENCE IS FIRST, AND IT IS NO LONGER AN EYEBROW
 *
 * It is what the rider reads aloud to the pharmacist at the counter, and what they match
 * against the label on the package. It is also, deliberately, the only thing that
 * identifies the CONTENTS — a reference names a package without describing it.
 *
 * It wore `.eyebrow`, which is 12px, weight 700, tracked 0.12em, uppercase, in
 * `--ink-faint`. Measured against `--canvas` that is **3.02:1**, where WCAG AA wants 4.5:1
 * for text this size — on a screen held at arm's length, outdoors, in direct sun, by
 * somebody wearing a helmet. `.rider-ref` sets the same string as ink at reading size:
 * **15.78:1**. See rider.css for the arithmetic and for why the tabular figures are not
 * decoration.
 *
 * ------------------------------------------------------------
 * THE HEADING IS `<h2>` AND WAS `<h3>`
 *
 * The page's `<h1>` is "Assignments" and there is nothing between it and these cards, so
 * `<h3>` skipped a level. A screen-reader user navigating by heading — which is the first
 * thing they do on a list screen, because it is how you find out how many deliveries there
 * are without reading all of them — hears a jump from 1 to 3 as a section they have missed,
 * and goes back looking for one that is not there.
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
    <Card as="li">
      <Stack gap="4">
        <Inline gap="3" justify="between">
          <span className="rider-ref grow">{delivery.reference}</span>
          <DeliveryStatusBadge status={delivery.status} />
        </Inline>

        <h2>{delivery.recipient_name}</h2>

        {/* The address as one block of ordinary prose rather than a labelled table. A rider
            reads it the way they would read it off a note: street, landmark, district. */}
        <p className="muted">
          {delivery.address_text}
          {delivery.landmark ? <> &middot; {delivery.landmark}</> : null}
          {delivery.district ? <> &middot; {delivery.district}</> : null}
        </p>

        <Inline gap="3">
          <CallRecipient name={delivery.recipient_name} phone={delivery.recipient_phone} />

          {/*
            A plain anchor, not next/link. Every navigation on this surface is a document
            load already — the tab bar in FieldShell is built from anchors for the same
            reason — and prefetching a delivery a rider has not opened spends their data
            bundle on a screen they may never look at.

            THE ACCESSIBLE NAME CARRIES THE REFERENCE AND THE VISIBLE LABEL DOES NOT.
            A screen-reader user pulling up the list of links on this page hears "Open,
            Open, Open, Open" — four identical names for four different deliveries, which
            is precisely the case WCAG's link-purpose requirement exists for. The visible
            word stays "Open" because the card around it already says which delivery it is
            to anyone who can see it; the `aria-label` says it again for the reader who is
            hearing the links out of that context.
          */}
          <Button
            href={href}
            variant="quiet"
            className="grow"
            aria-label={`Open delivery ${delivery.reference} for ${delivery.recipient_name}`}
          >
            Open
            <Icon name="chevRight" />
          </Button>
        </Inline>
      </Stack>
    </Card>
  )
}
