import type { BadgeTone } from '@carevelo/ui'
import type { DeliveryStatus } from './types'

/**
 * A delivery's status and its failure reason, as words.
 *
 * A WORD, NOT A COLOUR — the same rule the badge convention states, for the same reason: a
 * coloured dot is unreadable to a colour-blind dispatcher and invisible to a screen reader.
 * The tone decorates the word and never replaces it.
 */

export type StatusPresentation = {
  label: string
  tone: BadgeTone
  /** What the dispatcher does about it. */
  meaning: string
}

export const STATUS: Record<DeliveryStatus, StatusPresentation> = {
  unassigned: {
    label: 'Unassigned',
    tone: 'warn',
    meaning: 'Waiting for a rider. Nothing has been sent to anybody yet.',
  },
  assigned: {
    label: 'Assigned',
    tone: 'info',
    meaning: 'A rider has it on their list and can see the recipient and the address.',
  },
  picked_up: {
    label: 'Picked up',
    tone: 'info',
    meaning: 'Collected from the pharmacy.',
  },
  en_route: {
    label: 'On the way',
    tone: 'info',
    meaning: 'With the rider, on the way to the recipient.',
  },
  delivered: {
    label: 'Delivered',
    tone: 'good',
    meaning: 'Handed over. The order is complete.',
  },
  failed: {
    label: 'Failed',
    tone: 'bad',
    meaning:
      'The rider could not complete it. The medicine returns to the licensed premises — it '
      + 'never sits with a rider overnight.',
  },
  returned_to_pharmacy: {
    label: 'Back at the pharmacy',
    tone: 'bad',
    meaning:
      'Returned to the licensed premises. The patient is owed a reschedule or a refund, and '
      + 'reassigning a rider sends it out again.',
  },
}

/**
 * A status the API might send that this build has never heard of.
 *
 * `DeliveryResource.status` is a `string` in the generated schema (the resource emits the
 * enum's value), so every read has to narrow, and a value that does not narrow is shown as
 * itself rather than crashing the board. A dispatcher who sees an unfamiliar word can ring
 * somebody; a dispatcher who sees an error boundary cannot dispatch at all.
 */
export function present(status: string): StatusPresentation {
  return (
    STATUS[status as DeliveryStatus] ?? {
      label: status,
      tone: 'neutral' as const,
      meaning: 'This console does not recognise that state. It may be newer than this build.',
    }
  )
}

/**
 * The four reasons a delivery may fail.
 *
 * ------------------------------------------------------------
 * A FIXED LIST, AND NOT AN ARBITRARY ONE. `Delivery::FAILURE_REASONS` holds exactly these
 * four values, and the model's own comment says why it is a list at all: "Free text alone
 * cannot be reported on." A clinic that wants to know how often an address is wrong cannot
 * learn it from a thousand hand-typed sentences.
 *
 * ------------------------------------------------------------
 * THE DISPATCHER DOES NOT SET THESE, AND THERE IS NO FORM FOR THEM ANYWHERE IN THIS DOMAIN.
 *
 * A failure is recorded by the RIDER, through `POST /v1/rider/deliveries/{id}/status` —
 * the most restricted permission in the system, held only by the rider the delivery is
 * assigned to. `DeliveryPolicy::updateStatus` admits nobody else, and the dispatch board has
 * no endpoint that writes one. So this map exists to READ a reason back into English, and a
 * dispatcher who disagrees with a rider's reason resolves that by telephone and a
 * reassignment, not by editing what the rider said.
 */
export const FAILURE_REASONS: Record<string, string> = {
  recipient_unreachable: 'The recipient could not be reached',
  address_incorrect: 'The address was wrong',
  refused: 'The recipient refused it',
  rider_unable_to_complete: 'The rider could not complete it',
}

/** A failure reason in English, or the raw value if this build does not know it. */
export function failureReason(reason: string | null): string | null {
  if (reason === null) {
    return null
  }

  return FAILURE_REASONS[reason] ?? reason
}

/**
 * The board, in lanes.
 *
 * ------------------------------------------------------------
 * WHY LANES RATHER THAN ONE LIST WITH A PAGER: see `DeliveryPage`. The endpoint pages by
 * offset, the house rule is cursor, and an offset over a table being written to is how a
 * live board loses a row. One request per status, oldest first, no page number ever sent.
 *
 * `delivered` IS DELIBERATELY NOT A LANE. A board is a worklist, and a delivered package
 * needs nothing from a dispatcher. It is reached by its own URL from the order, which is
 * where somebody asking "what happened to this one" starts anyway.
 *
 * The order below is the order a dispatcher works in: what needs a rider, what is out, what
 * came back.
 */
export type LaneId =
  | 'unassigned'
  | 'assigned'
  | 'picked_up'
  | 'en_route'
  | 'failed'
  | 'returned_to_pharmacy'

export type Lane = {
  status: DeliveryStatus
  heading: string
  lede: string
  empty: string
}

export const LANE_IDS: readonly LaneId[] = [
  'unassigned',
  'assigned',
  'picked_up',
  'en_route',
  'failed',
  'returned_to_pharmacy',
]

export const LANES: Record<LaneId, Lane> = {
  unassigned: {
    status: 'unassigned',
    heading: 'Needs a rider',
    lede: 'Created and waiting. No address has reached anybody yet.',
    empty: 'Nothing waiting for a rider.',
  },
  assigned: {
    status: 'assigned',
    heading: 'Assigned',
    lede: 'With a rider, not yet collected from the pharmacy.',
    empty: 'Nothing assigned.',
  },
  picked_up: {
    status: 'picked_up',
    heading: 'Picked up',
    lede: 'Collected from the pharmacy.',
    empty: 'Nothing collected.',
  },
  en_route: {
    status: 'en_route',
    heading: 'On the way',
    lede: 'In transit to the recipient.',
    empty: 'Nothing on the way.',
  },
  failed: {
    status: 'failed',
    heading: 'Failed',
    lede: 'The rider could not complete it. Each one needs a decision.',
    empty: 'No failed deliveries.',
  },
  returned_to_pharmacy: {
    status: 'returned_to_pharmacy',
    heading: 'Back at the pharmacy',
    lede: 'Returned to the licensed premises. Reassign to send it out again.',
    empty: 'Nothing has come back.',
  },
}
