import type { BadgeTone } from '@carevelo/ui'
import type { DispenseOrderStatus } from '../api/orders'

/**
 * A dispense order's status, as a word and as a colour — in that order of importance.
 *
 * THE WORD IS WHAT THE PATIENT READS. `Badge` in packages/ui requires children for exactly
 * this reason: a coloured pill says nothing to a colour-blind reader and nothing at all to
 * a screen reader, and two of the states below are "Cancelled" and "Not dispensed".
 *
 * THE WORDS ARE THE PATIENT'S, NOT THE PHARMACY BENCH'S. `awaiting_substitution` and
 * `partially_priced` are a state machine's vocabulary, written for the pharmacist working
 * the queue. What somebody waiting for their medicine needs to know is whether anything is
 * owed, whether it is ready, and whether it is coming to them — so the mapping is done once
 * here rather than in a component, and the two screens that read an order status cannot
 * drift into describing the same state differently.
 *
 * AND NONE OF THEM DESCRIBE THE CONTENTS. The listing does not load the prescription, so
 * there is no field here that could name a medicine, and no wording below should imply one.
 * "Your antibiotics are ready" is the sentence this file exists to make unwriteable.
 *
 * SIXTEEN CASES AND NO DEFAULT ARM IN THE TABLE. `Record<DispenseOrderStatus, …>` means a
 * status added to the API's enum stops this file compiling, which is the point: the
 * alternative is a new state quietly rendering as an empty badge on a patient's screen. The
 * lookups still fall through to an honest "not available", because the resource types
 * `status` as a plain `string` rather than as the enum and a value nobody anticipated must
 * not be asserted into one.
 */

/** The message key under the `Dispensing` namespace. A literal union, so `t()` types it. */
export type OrderStatusKey =
  | 'status.received'
  | 'status.under_review'
  | 'status.awaiting_substitution'
  | 'status.priced'
  | 'status.partially_priced'
  | 'status.awaiting_payment'
  | 'status.paid'
  | 'status.dispensed'
  | 'status.ready_for_pickup'
  | 'status.out_for_delivery'
  | 'status.collected'
  | 'status.completed'
  | 'status.returned'
  | 'status.refund_pending'
  | 'status.cancelled'
  | 'status.rejected'
  | 'status.unknown'

const WORDS: Record<DispenseOrderStatus, OrderStatusKey> = {
  received: 'status.received',
  under_review: 'status.under_review',
  awaiting_substitution: 'status.awaiting_substitution',
  priced: 'status.priced',
  partially_priced: 'status.partially_priced',
  awaiting_payment: 'status.awaiting_payment',
  paid: 'status.paid',
  dispensed: 'status.dispensed',
  ready_for_pickup: 'status.ready_for_pickup',
  out_for_delivery: 'status.out_for_delivery',
  collected: 'status.collected',
  completed: 'status.completed',
  returned: 'status.returned',
  refund_pending: 'status.refund_pending',
  cancelled: 'status.cancelled',
  rejected: 'status.rejected',
}

/*
 * THE TONES SAY "IS ANYTHING WANTED FROM ME?", NOT "HOW FAR ALONG IS THIS?".
 *
 * `warn` is reserved for the two states where the patient has something to do or something
 * to chase — money owed, and a refund being arranged — because an amber pill in a list is
 * read as an instruction and there should be nothing else competing with it.
 *
 * `returned` is WARN rather than BAD: the medicines are safe and back where they started,
 * which is the system working, and red would tell a patient something was lost. `rejected`
 * is the one that is genuinely bad — the pharmacy declined to dispense, and that is a
 * conversation with the clinic. `cancelled` is neutral because a cancellation is usually
 * the patient's own doing and colouring it red reads as an accusation.
 */
const TONES: Record<DispenseOrderStatus, BadgeTone> = {
  received: 'neutral',
  under_review: 'info',
  awaiting_substitution: 'info',
  priced: 'info',
  partially_priced: 'info',
  awaiting_payment: 'warn',
  paid: 'info',
  dispensed: 'info',
  ready_for_pickup: 'good',
  out_for_delivery: 'info',
  collected: 'good',
  completed: 'good',
  returned: 'warn',
  refund_pending: 'warn',
  cancelled: 'neutral',
  rejected: 'bad',
}

/**
 * Both of these take a plain `string` and fall through to an honest "not available" for a
 * value nobody anticipated — rather than asserting a cast and rendering an empty badge.
 * `DispenseOrderResource` types `status` as a string, so the cast below is the narrowing
 * for the lookup and never a claim about what arrived.
 */
export function orderStatusWord(status: string): OrderStatusKey {
  return WORDS[status as DispenseOrderStatus] ?? 'status.unknown'
}

export function orderStatusTone(status: string): BadgeTone {
  return TONES[status as DispenseOrderStatus] ?? 'neutral'
}

/**
 * The one status where the portal has something for the patient to PRESS.
 *
 * `awaiting_payment` is the only state in which a patient owes the clinic money through
 * this portal, and it is therefore the only state where a row's link should go to the
 * payment screen rather than to the order's own. Named here, beside the words and the
 * tones, so the three readings of a status live together — a component that decided this
 * inline would be a second, invisible copy of the state machine's meaning.
 *
 * NOT A LIST OF "STATES A PATIENT MAY PAY IN". The API decides that, and it decides it
 * again on submission; this is a decision about where a link goes. A patient who opens a
 * priced-but-not-yet-payable order simply sees the order.
 */
export function awaitsPayment(status: string): boolean {
  return status === 'awaiting_payment'
}
