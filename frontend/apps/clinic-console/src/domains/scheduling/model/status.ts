import type { BadgeTone } from '@carevelo/ui'
import type { AppointmentStatus } from './types'

/**
 * How each state of the appointment state machine reads on a staff screen.
 *
 * THE COLOUR IS NEVER THE ONLY SIGNAL. Every badge carries the word as well, because a
 * coloured pill says nothing to a colour-blind clinician and less to a screen reader. The
 * tone is a second opinion on a fact the text already states.
 *
 * THE TONES ARE CAREVELO'S, NOT THE CLINIC'S. A status means the same thing in every
 * tenant, so these resolve `--good` / `--warn` / `--bad` and never `--brand-*`. On this
 * surface that is doubly true: the console is Carevelo's, the clinic's logo appears in the
 * header and the clinic's colours do not.
 *
 * ------------------------------------------------------------------------------------
 * WHY `awaiting_payment` IS THE ONE THE DAY VIEW HAS TO SHOUT ABOUT
 *
 * `AppointmentController::SLOT_HOLDING` counts `awaiting_payment` alongside `confirmed` and
 * `in_progress`: a prepaid booking HOLDS the clinician's slot while the patient pays, so
 * availability excludes it and nobody else can take that time. That is correct — releasing
 * it mid-transaction would let a second patient book over someone who is paying — but it
 * means a hold nothing ever releases removes a slot from the clinic's calendar and looks,
 * on a naive board, exactly like a booking. It is not one. Nobody has paid, nobody is
 * confirmed to come, and `appointments:release-unpaid` will take it back.
 *
 * So `held` below is a fact the day view renders differently from `booked`, and it is the
 * reason this file exports more than a colour map.
 *
 * @see docs/20-domain/state-machines.md
 */

export const STATUS_TONE: Record<AppointmentStatus, BadgeTone> = {
  awaiting_payment: 'warn',
  payment_failed: 'bad',
  confirmed: 'good',
  in_progress: 'info',
  // Endings. None of them is a problem anybody can act on from a day view, and painting an
  // ending amber invites somebody to try to fix it.
  completed: 'neutral',
  cancelled: 'neutral',
  no_show: 'neutral',
  expired: 'neutral',
  abandoned: 'neutral',
}

/**
 * The word.
 *
 * `expired` and `cancelled` are deliberately different sentences: expiry is the system
 * releasing an unpaid slot, cancellation is a human decision. A clinic owner reads those
 * differently and so does the receptionist wondering whether they did something.
 */
export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  awaiting_payment: 'Holding — unpaid',
  payment_failed: 'Payment failed',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'Did not attend',
  expired: 'Hold expired',
  abandoned: 'Abandoned',
}

/**
 * The one line of explanation a state needs on a working screen, or nothing.
 *
 * Only where the state is genuinely misread without it. A caption under every badge is a
 * caption nobody reads.
 */
export const STATUS_NOTE: Partial<Record<AppointmentStatus, string>> = {
  awaiting_payment:
    'This slot is held, not booked. The patient has not paid and the hold is released '
    + 'automatically. An administrator can confirm it on the clinic\'s authority.',
  payment_failed:
    'The collection failed. The slot is no longer held — rebook, or confirm on the '
    + 'clinic\'s authority if the patient will settle at the desk.',
  abandoned: 'The consultation ended in technical failure and could not be resumed.',
}

/** Statuses that occupy a clinician's time, from the clinician's point of view. */
const OCCUPIES: readonly AppointmentStatus[] = ['awaiting_payment', 'confirmed', 'in_progress']

/**
 * Does this appointment take up the clinician's time today?
 *
 * Mirrors `AppointmentController::SLOT_HOLDING` exactly. If that list moves and this one
 * does not, the symptom is a day that looks free and is not — so it is named here rather
 * than open-coded into a filter.
 */
export function occupiesSlot(status: AppointmentStatus): boolean {
  return OCCUPIES.includes(status)
}

/** Held but not paid: the state the board must not let pass as a booking. */
export function isUnpaidHold(status: AppointmentStatus): boolean {
  return status === 'awaiting_payment'
}

/** Can a clinician enter the room for this appointment right now, as far as status goes? */
export function isEnterable(status: AppointmentStatus): boolean {
  // Exactly `JoinTokenController::assertJoinable`. The window is checked separately,
  // because "not yet" and "not allowed" are different sentences.
  return status === 'confirmed' || status === 'in_progress'
}

/**
 * Narrow an unchecked string to a status, or null.
 *
 * `AppointmentResource` types `status` as a bare string — Scramble cannot see through the
 * enum cast on the model — so a narrowing step is needed somewhere, and this is the one
 * place it happens. `satisfies` ties the list to the generated union, so a status added to
 * the contract breaks this build rather than falling silently through into a blank badge.
 */
const STATUSES = [
  'awaiting_payment',
  'payment_failed',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
  'expired',
  'abandoned',
] as const satisfies readonly AppointmentStatus[]

export function asStatus(value: string | null | undefined): AppointmentStatus | null {
  return STATUSES.find((status) => status === value) ?? null
}
