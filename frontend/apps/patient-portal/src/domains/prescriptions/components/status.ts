import type { BadgeTone } from '@carevelo/ui'
import type { PrescriptionStatus } from '../api/prescriptions'

/**
 * A prescription's status, as a word and as a colour — in that order of importance.
 *
 * THE WORD CARRIES THE MEANING AND THE COLOUR IS A SECOND OPINION. `Badge` in packages/ui
 * makes the same argument and enforces it by requiring children: a coloured pill is
 * unreadable to a colour-blind patient and invisible to a screen reader, and one of the
 * things labelled here is "this prescription was cancelled".
 *
 * THE RESOURCE SENDS `status` AS A PLAIN STRING, not as the enum. That is deliberate on
 * the backend — the same looseness that lets a snapshot reproduce a value written before
 * an enum existed — so both functions take a string and fall through to an honest
 * "not available" rather than asserting a cast and rendering an empty badge for a value
 * nobody anticipated.
 */

/** The message key under the `Prescriptions` namespace. A literal union, so `t()` types it. */
export type StatusKey =
  | 'status.issued'
  | 'status.cancelled'
  | 'status.superseded'
  | 'status.unknown'

const WORDS: Record<PrescriptionStatus, StatusKey> = {
  issued: 'status.issued',
  cancelled: 'status.cancelled',
  superseded: 'status.superseded',
}

/*
 * `issued` is the good state and reads as "Active", because "Issued" describes what the
 * clinic did and the patient wants to know whether it still stands. `superseded` is
 * NEUTRAL rather than bad: being replaced is the ordinary way a prescription is corrected,
 * and colouring it red would tell a patient something went wrong when nothing did.
 */
const TONES: Record<PrescriptionStatus, BadgeTone> = {
  issued: 'good',
  cancelled: 'bad',
  superseded: 'neutral',
}

export function statusWord(status: string): StatusKey {
  return WORDS[status as PrescriptionStatus] ?? 'status.unknown'
}

export function statusTone(status: string): BadgeTone {
  return TONES[status as PrescriptionStatus] ?? 'neutral'
}
