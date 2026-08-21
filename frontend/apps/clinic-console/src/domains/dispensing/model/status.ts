import type { BadgeTone } from '@carevelo/ui'
import type { DispenseOrderStatus } from './types'

/**
 * The order's status, as a word and a tone.
 *
 * A WORD, NOT A COLOUR. `components.css` says it outright and it is the reason `Badge`
 * requires children: a coloured dot is unreadable to a colour-blind pharmacist and
 * invisible to a screen reader. The tone is decoration on top of the word, never instead
 * of it.
 *
 * A `Record` over the generated union, so a status added to the contract is a compile
 * error here rather than a raw `awaiting_substitution` appearing on a clinic's screen.
 */

export type StatusPresentation = {
  label: string
  tone: BadgeTone
  /** One line explaining what the pharmacy does next. Shown on the order, not in the queue. */
  meaning: string
}

export const STATUS: Record<DispenseOrderStatus, StatusPresentation> = {
  received: {
    label: 'Received',
    tone: 'info',
    meaning: 'Waiting for a pharmacist to take it to the bench.',
  },
  under_review: {
    label: 'Under review',
    tone: 'info',
    meaning: 'At the bench. Check stock, then price every prescribed item.',
  },
  awaiting_substitution: {
    label: 'Awaiting substitution',
    tone: 'warn',
    meaning:
      'A substitute has been proposed and the prescribing clinician has to decide. '
      + 'Only the affected item is blocked — the rest of the order can still be priced.',
  },
  partially_priced: {
    label: 'Partially priced',
    tone: 'warn',
    meaning: 'Priced with one or more items recorded as unfulfilled, each with a reason.',
  },
  priced: {
    label: 'Priced',
    tone: 'good',
    meaning: 'The patient has been told the total and can choose pickup or delivery.',
  },
  awaiting_payment: {
    label: 'Awaiting payment',
    tone: 'warn',
    meaning: 'Waiting on the patient. Payment settles to the clinic, never to Carevelo.',
  },
  paid: {
    label: 'Paid',
    tone: 'good',
    meaning: 'Ready to be dispensed by a named pharmacist.',
  },
  dispensed: {
    label: 'Dispensed',
    tone: 'good',
    meaning: 'Handed over at the bench and recorded against the pharmacist who did it.',
  },
  ready_for_pickup: {
    label: 'Ready for pickup',
    tone: 'good',
    meaning: 'On the shelf with the patient’s name on it, waiting to be collected.',
  },
  out_for_delivery: {
    label: 'Out for delivery',
    tone: 'info',
    meaning: 'With dispatch. Follow it on the dispatch board.',
  },
  collected: {
    label: 'Collected',
    tone: 'neutral',
    meaning: 'The patient collected it at the pharmacy. Terminal.',
  },
  completed: {
    label: 'Completed',
    tone: 'neutral',
    meaning: 'Delivered and closed. Terminal.',
  },
  returned: {
    label: 'Returned',
    tone: 'bad',
    meaning:
      'The delivery failed and the medicine came back to the licensed premises. '
      + 'The patient is owed a reschedule or a refund.',
  },
  refund_pending: {
    label: 'Refund pending',
    tone: 'bad',
    meaning:
      'A refund is owed. The clinic executes it through its own aggregator — this state '
      + 'makes the obligation visible, it does not discharge it.',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'neutral',
    meaning: 'The prescription behind this order was cancelled. Terminal.',
  },
  rejected: {
    label: 'Rejected',
    tone: 'bad',
    meaning: 'The pharmacy declined to fill it, and the reason is on the record.',
  },
}

/**
 * A status the API might send that this build has never heard of.
 *
 * `DispenseOrderResource.status` is typed `string` in the generated schema, because the
 * resource emits `$this->status->value` and the generator cannot see the enum through it.
 * So every read has to narrow, and a value that does not narrow gets shown as itself
 * rather than crashing the queue: a pharmacist seeing an unfamiliar word can still ring
 * somebody, and a pharmacist seeing an error boundary cannot work at all.
 */
export function present(status: string): StatusPresentation {
  return (
    STATUS[status as DispenseOrderStatus] ?? {
      label: status,
      tone: 'neutral' as const,
      meaning: 'This console does not recognise that state. It may be newer than this build.',
    }
  )
}

/**
 * The queue, in lanes.
 *
 * ------------------------------------------------------------
 * WHY LANES RATHER THAN ONE LIST WITH A PAGER.
 *
 * `GET /v1/dispense-orders` pages by offset (see the note on `DispenseOrderPage`), and an
 * offset over a table that is being written to is how a live queue loses a row. The house
 * rule says cursor, the contract offers page numbers, and the way out is not to page at
 * all: each lane is ONE request filtered to ONE status, oldest first, capped at the
 * endpoint's maximum page size. Nothing in this domain ever sends `page`, so there is no
 * offset to be wrong.
 *
 * That works because a pharmacy queue is a worklist and not an archive. The lanes below
 * are the states where somebody has to do something; every terminal state is deliberately
 * absent, and an order in one is reached by its own URL rather than by scrolling. If a
 * clinic ever has more than a hundred orders sitting in a single actionable state, the
 * screen says so in words instead of quietly showing the oldest hundred — see
 * `QueueLane`'s overflow notice.
 *
 * ORDERED THE WAY A BENCH WORKS: what is waiting to be picked up first, what is in hand
 * next, then what is waiting on somebody else.
 */
export type LaneId = 'received' | 'under_review' | 'awaiting_substitution' | 'paid' | 'ready_for_pickup'

export type Lane = {
  status: DispenseOrderStatus
  heading: string
  /** What the pharmacist is looking at this lane to decide. */
  lede: string
  /** Shown in place of the table when the lane is empty. */
  empty: string
}

export const LANE_IDS: readonly LaneId[] = [
  'received',
  'under_review',
  'awaiting_substitution',
  'paid',
  'ready_for_pickup',
]

export const LANES: Record<LaneId, Lane> = {
  received: {
    status: 'received',
    heading: 'New',
    lede: 'Arrived from an issued prescription and not yet opened.',
    empty: 'No new orders. New prescriptions appear here on their own.',
  },
  under_review: {
    status: 'under_review',
    heading: 'At the bench',
    lede: 'Opened, waiting to be checked against the shelf and priced.',
    empty: 'Nothing at the bench.',
  },
  awaiting_substitution: {
    status: 'awaiting_substitution',
    heading: 'Waiting on a clinician',
    lede: 'A substitute has been proposed. Only the affected item is blocked.',
    empty: 'No substitutions waiting for a decision.',
  },
  paid: {
    status: 'paid',
    heading: 'Ready to dispense',
    lede: 'Paid for. A named pharmacist hands these over.',
    empty: 'Nothing waiting to be dispensed.',
  },
  ready_for_pickup: {
    status: 'ready_for_pickup',
    heading: 'On the shelf',
    lede: 'Dispensed and waiting for the patient to collect.',
    empty: 'Nothing waiting to be collected.',
  },
}
