import type { Appointment } from './types'

/**
 * The fifteen minutes a prepaid booking holds a slot for, and how to tell the truth
 * about them.
 *
 * WHERE THE NUMBER COMES FROM. `Appointment::UNPAID_HOLD_MINUTES = 15`, swept by
 * `appointments:release-unpaid`, which expires anything still `awaiting_payment` fifteen
 * minutes after `created_at`. The PRD explains the choice: the window matches the
 * aggressive phase of the payment poll schedule, which checks every minute for the first
 * fifteen — so the slot is released at the moment the system stops expecting an imminent
 * mobile-money confirmation.
 *
 * WHY THE PATIENT IS TOLD. Availability EXCLUDES a held slot, so a hold is a real thing
 * taken away from the clinic's calendar and given to one person for a quarter of an hour.
 * A patient who believes they have longer than they do abandons a prompt, comes back to
 * an expired booking and has to start again — and most mobile-money prompts are never
 * completed, so this is the common case rather than the edge one. Showing the deadline is
 * the difference between a product that is honest about a constraint and one that hides
 * it until it bites.
 *
 * THE DEADLINE IS DERIVED, NOT SENT. `AppointmentResource` carries `created_at` and no
 * expiry field, so this is arithmetic on the contract rather than a value the API
 * promised. If the backend ever publishes the deadline itself, this function is the one
 * place to change.
 */
export const UNPAID_HOLD_MINUTES = 15

const MS_PER_MINUTE = 60_000

/**
 * When this booking's hold runs out, or `null` if it is not holding one.
 *
 * Only `awaiting_payment` holds a slot. A confirmed booking is not on a clock, and
 * showing a countdown against one would frighten a patient who has already paid.
 */
export function holdExpiresAt(appointment: Appointment): string | null {
  if (appointment.status !== 'awaiting_payment') {
    return null
  }

  const created = Date.parse(appointment.created_at)

  if (Number.isNaN(created)) {
    return null
  }

  return new Date(created + UNPAID_HOLD_MINUTES * MS_PER_MINUTE).toISOString()
}
