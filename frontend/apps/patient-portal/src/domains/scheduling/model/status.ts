import type { BadgeTone, IconName } from '@carevelo/ui'
import type { AppointmentStatus } from './types'

/**
 * How each state of the appointment state machine looks in a badge.
 *
 * THE COLOUR IS NEVER THE ONLY SIGNAL. Every badge in this domain carries the word as
 * well, from the message catalogue, because a coloured pill says nothing to a
 * colour-blind patient and less to a screen reader. The tone is a second opinion on a
 * fact the text already states.
 *
 * THE TONES ARE OURS, NOT THE CLINIC'S. A status means the same thing in every tenant, so
 * `.badge-good` reads `--good` rather than `--brand-primary`: a clinic whose brand colour
 * is red must not end up with "Confirmed" in red.
 *
 * WHY SO MANY ARE NEUTRAL. `completed`, `cancelled`, `no_show`, `expired` and `abandoned`
 * are all endings, and none of them is a problem the patient can act on from this screen.
 * Painting an ending amber invites somebody to try to fix it. `payment_failed` is the one
 * genuinely bad state, because it is the one where money was expected and did not arrive
 * and the patient still wants the appointment.
 *
 * `expired` AND `cancelled` ARE DELIBERATELY DIFFERENT and the copy keeps them apart:
 * expiry is the system releasing an unpaid slot, cancellation is a human decision. The
 * clinic owner reads those differently and so does the patient who is wondering whether
 * they did something.
 *
 * @see docs/20-domain/state-machines.md
 */

export const STATUS_TONE: Record<AppointmentStatus, BadgeTone> = {
  awaiting_payment: 'warn',
  payment_failed: 'bad',
  confirmed: 'good',
  in_progress: 'info',
  completed: 'neutral',
  cancelled: 'neutral',
  no_show: 'neutral',
  expired: 'neutral',
  abandoned: 'neutral',
}

export const STATUS_ICON: Partial<Record<AppointmentStatus, IconName>> = {
  awaiting_payment: 'clock',
  confirmed: 'check',
  in_progress: 'activity',
}

const KNOWN = new Set<string>(Object.keys(STATUS_TONE))

/**
 * Narrow the resource's `status`, which the contract types as a plain string.
 *
 * A state this build does not know about is rendered with the neutral tone and a generic
 * word rather than crashing or, worse, being silently omitted: a patient looking at a
 * booking whose status vanished has been told nothing at all.
 */
export function knownStatus(status: string): AppointmentStatus | null {
  return KNOWN.has(status) ? (status as AppointmentStatus) : null
}
