import type { BadgeTone } from '@carevelo/ui'
import type { PatientStatus } from '../api/types'

/**
 * What a patient's status MEANS to the person reading it, in the clinic's own words.
 *
 * WHY THE MEANING IS HERE AND NOT WRITTEN INTO EACH SCREEN. The registry, the record and the
 * consent screen all show the same four states, and the console's standing caution for this
 * section is that "the screen has to make the state obvious, because a member of staff who
 * cannot see why a note will not save will find a way around the product." Four states
 * described three times drift into three different explanations of the same word, and the one
 * a receptionist happens to read is then a coin toss.
 *
 * A WORD, AND ONLY THEN A COLOUR. Every entry carries a label; the tone is decoration on top
 * of it. A coloured dot is unreadable to a colour-blind receptionist and silent to a screen
 * reader, which is the convention the whole badge system in components.css exists to enforce.
 *
 * `pending_consent` IS NOT `warn` BECAUSE SOMETHING WENT WRONG. It is the state every
 * registration begins in and the state the desk is expected to move a patient out of within a
 * minute of registering them; the tone marks it as unfinished business at the counter rather
 * than as a fault.
 *
 * @see docs/20-domain/state-machines.md
 */

type StatusDisplay = {
  /** The word on the badge. Short enough for a table cell. */
  readonly label: string
  readonly tone: BadgeTone
  /** One sentence a member of staff can act on. Rendered beside the record, not in the table. */
  readonly meaning: string
}

/**
 * Keyed by the contract's own union, so a fifth status added to `PatientStatus` is a compile
 * error here rather than a blank badge in a registry somebody is trying to work from.
 */
const DISPLAY: Record<PatientStatus, StatusDisplay> = {
  pending_consent: {
    label: 'Awaiting consent',
    tone: 'warn',
    meaning:
      'Registered, and nothing more can happen yet. No clinical data may attach to this '
      + 'record until the patient has agreed to their information being processed — that is '
      + 'enforced in the database, so a note simply will not save. Capture consent with the '
      + 'patient present.',
  },
  active: {
    label: 'Active',
    tone: 'good',
    meaning: 'Consented to data processing. This record can be booked, consulted and dispensed against.',
  },
  withdrawn: {
    label: 'Consent withdrawn',
    tone: 'warn',
    meaning:
      'The patient withdrew consent to their information being processed. New processing '
      + 'stops; the medical record already on file is kept for as long as the clinic is '
      + 'obliged to keep it. To resume care, capture consent again with the patient present.',
  },
  discarded: {
    label: 'Registration ended',
    tone: 'neutral',
    meaning:
      'Consent was declined, so registration ended and the details collected during it were '
      + 'cleared. This record exists only to explain why service could not proceed, and it '
      + 'is purged on schedule. It cannot be edited, consented or given an account — register '
      + 'again to start over.',
  },
}

/**
 * The display for a status, tolerating a value this build has never heard of.
 *
 * `PatientResource.status` is a bare `string` on the wire — the backend serialises the column
 * rather than the enum — so an unrecognised value is a real possibility rather than a
 * defensive fiction. It falls through to the raw value with a neutral tone and an honest
 * sentence, because a receptionist is better served by an unfamiliar word and "this console
 * does not recognise it" than by a blank cell where a patient's state should be.
 */
export function statusDisplay(status: string): StatusDisplay {
  return (
    DISPLAY[status as PatientStatus] ?? {
      label: status,
      tone: 'neutral' as const,
      meaning:
        'This console does not recognise that status, which means the API is ahead of it. '
        + 'Nothing here is wrong with the patient record; treat the state as unknown and check '
        + 'with an administrator before acting on it.',
    }
  )
}

/**
 * Whether this record can still be corrected, consented or given an account.
 *
 * `discarded` IS FINAL AND THE API SAYS SO IN THREE PLACES — `PatientController::update`,
 * `ConsentController::assertDecisionIsPossible` and
 * `PatientAccountController::assertRecordCanHoldAnAccount` each throw an `IllegalTransition`.
 * The screens ask this first so a member of staff is told before they fill a form in, not
 * after; the API's refusal is still the control, and the wording it returns is still what gets
 * shown if the two ever disagree.
 */
export function isFinalised(status: string): boolean {
  return status === 'discarded'
}
