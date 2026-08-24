import type { GrantScope } from './types'

/**
 * The eight scopes, in the contract's own order, each with the sentence an operator needs
 * before choosing it.
 *
 * ============================================================
 * WHY EVERY OPTION SAYS WHAT IT REACHES RATHER THAN NAMING A TABLE
 * ============================================================
 *
 * `scope` is the field a reviewer sorts by months later, when nobody remembers the
 * incident. A picker that offered eight bare identifiers would be answered by whichever one
 * looked closest, and the register would fill up with `patient_record` because it sounds
 * like everything — which is the outcome the field exists to prevent.
 *
 * So each note says, in ordinary words, what a grant of that scope lets a Carevelo operator
 * read. The narrowest scope that answers the question is the correct one, and the notes are
 * written so that the narrowest one is findable.
 *
 * ============================================================
 * `audit_trail` IS NOT THE SAFE OPTION
 * ============================================================
 *
 * It is the one people reach for thinking it is metadata and therefore harmless. A clinic's
 * audit trail names which clinician saw which patient and when, which is health-adjacent
 * information about identified people even with no clinical content in it. It is a scope
 * like the others, it notifies the clinic like the others, and its note says so.
 *
 * ============================================================
 * THE ORDER IS THE CONTRACT'S AND NOT A RANKING
 * ============================================================
 *
 * Nothing here is presented as a default, and no option is pre-selected on the form. A
 * pre-selected scope on an emergency form is a scope that gets submitted unread.
 *
 * @see docs/50-security-compliance/rbac-matrix.md § Break-glass
 */
export const SCOPES: readonly { readonly value: GrantScope; readonly label: string; readonly note: string }[] = [
  {
    value: 'patient_record',
    label: 'Patient record',
    note:
      'Identity, contact details and the demographic record. The widest scope on this list '
      + 'and the one most often chosen by mistake — if the question is about one '
      + 'consultation or one prescription, this is not it.',
  },
  {
    value: 'consultation',
    label: 'Consultation',
    note: 'The consultation record: when it happened, with whom, in which mode, and its outcome.',
  },
  {
    value: 'clinical_note',
    label: 'Clinical note',
    note:
      'What a clinician wrote. Special-category health data in free text, and the most '
      + 'sensitive thing this platform stores.',
  },
  {
    value: 'prescription',
    label: 'Prescription',
    note: 'Issued prescriptions and their items, including controlled ones.',
  },
  {
    value: 'dispensing',
    label: 'Dispensing',
    note: 'What the pharmacy actually put in the bag, substitutions included.',
  },
  {
    value: 'delivery',
    label: 'Delivery',
    note:
      'The delivery record and its addresses. Carries no clinical content by construction — '
      + 'a rider payload never does — but it does place a named patient at an address.',
  },
  {
    value: 'payment',
    label: 'Payment',
    note:
      'Payment intents, references and attempts. Every shilling belongs to the clinic; '
      + 'nothing here is a Carevelo account, and there is nothing to move.',
  },
  {
    value: 'audit_trail',
    label: 'Audit trail',
    note:
      'The clinic’s own audit events. Not the safe option: it names which clinician saw '
      + 'which patient and when, which is health-adjacent information about identified '
      + 'people even with no clinical content in it.',
  },
]

const KNOWN = new Set<string>(SCOPES.map((scope) => scope.value))

/** Narrow a value that arrived through a form. A scope this build does not know is not a scope. */
export function isScope(value: string): value is GrantScope {
  return KNOWN.has(value)
}

/** The label for a scope on a grant already issued, falling back to the raw value. */
export function scopeLabel(value: string): string {
  return SCOPES.find((scope) => scope.value === value)?.label ?? value
}
