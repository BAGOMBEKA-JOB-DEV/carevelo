import type { components, operations } from '@carevelo/api-client'

/**
 * Every shape this domain handles, taken from the generated contract. Not one is
 * hand-written; see the same note in the scheduling domain for why that rule is absolute.
 */

export type Appointment = components['schemas']['AppointmentResource']
export type Consultation = components['schemas']['ConsultationResource']
export type ClinicalNote = components['schemas']['ClinicalNoteResource']
export type ConsultationMode = components['schemas']['ConsultationMode']
export type ConsultationOutcome = components['schemas']['ConsultationOutcome']
export type Patient = components['schemas']['PatientResource']
export type Prescription = components['schemas']['PrescriptionResource']

export type ConsultationsPage =
  operations['v1.consultations.index']['responses'][200]['content']['application/json']

export type PrescriptionsPage =
  operations['v1.prescriptions.index']['responses'][200]['content']['application/json']

/*
 * The enum values, as values.
 *
 * `ConsultationResource` types `mode_used` and `outcome` as bare strings — Scramble cannot
 * see through the cast on the model — so a narrowing step is needed somewhere, and this is
 * the one place it happens. `satisfies` ties each list to the generated union, so a mode or
 * an outcome added to the contract breaks this build rather than falling silently through a
 * lookup into a blank label.
 */
const MODES = ['in_person', 'video', 'voice', 'chat'] as const satisfies readonly ConsultationMode[]

const OUTCOMES = [
  'completed',
  'patient_no_show',
  'clinician_unavailable',
  'converted_to_in_person',
  'technical_failure',
] as const satisfies readonly ConsultationOutcome[]

export function asMode(value: string | null | undefined): ConsultationMode | null {
  return MODES.find((mode) => mode === value) ?? null
}

export function asOutcome(value: string | null | undefined): ConsultationOutcome | null {
  return OUTCOMES.find((outcome) => outcome === value) ?? null
}

/**
 * The three modes a REMOTE consultation can actually be conducted in.
 *
 * `RecordModeRequest` refuses `in_person` deliberately: a remote consultation does not become
 * an in-person one by changing a field. A clinician who decides the patient must be seen
 * ENDS the consultation with the outcome `converted_to_in_person`, which is a different act
 * with a different consequence — no prescription may be issued on it.
 */
export const REMOTE_MODES = ['video', 'voice', 'chat'] as const

export type RemoteMode = (typeof REMOTE_MODES)[number]

export function isRemoteMode(value: string): value is RemoteMode {
  return (REMOTE_MODES as readonly string[]).includes(value)
}

/**
 * How much of a connection each mode asks for, ordered.
 *
 * Used only to tell a step DOWN from a step back UP, so the announcement can say which
 * happened. The state machine allows both directions, and a screen that admitted only
 * degradation would be no more truthful than one that admitted neither.
 */
export const MODE_DEMAND: Record<ConsultationMode, number> = {
  chat: 0,
  voice: 1,
  video: 2,
  // Not reachable on a remote consultation. Ranked highest so that if one ever appears it
  // does not read as a degradation.
  in_person: 3,
}

export const MODE_LABEL: Record<ConsultationMode, string> = {
  in_person: 'In person',
  video: 'Video',
  voice: 'Voice',
  chat: 'Chat',
}

/**
 * The five outcomes, in the words a clinician would use, with the consequence spelled out
 * where there is one.
 *
 * `converted_to_in_person` CARRIES A HARD CONSEQUENCE AND SAYS SO HERE, not in a tooltip: no
 * prescription may be issued on a consultation that ended this way. `Prescription::issue()`
 * enforces it and this label is what stops a clinician discovering it after the fact.
 */
export const OUTCOME_LABEL: Record<ConsultationOutcome, string> = {
  completed: 'Completed',
  patient_no_show: 'Patient did not join',
  clinician_unavailable: 'I could not hold it',
  converted_to_in_person: 'Referred for in-person care',
  technical_failure: 'Technical failure',
}

export const OUTCOME_NOTE: Record<ConsultationOutcome, string> = {
  completed: 'The consultation took place. This is the only outcome that permits prescribing.',
  patient_no_show: 'The patient never joined. The appointment is closed and no prescription can be issued.',
  clinician_unavailable: 'You were unable to hold it. The appointment is closed and no prescription can be issued.',
  converted_to_in_person:
    'You judged remote care unsafe and the patient must be seen. NO PRESCRIPTION MAY BE '
    + 'ISSUED on this consultation — that is enforced, not advised. Book the in-person '
    + 'appointment from the schedule.',
  technical_failure:
    'The connection failed and could not be resumed. The appointment is marked abandoned and '
    + 'no prescription can be issued.',
}

/** The only outcome `Prescription::issue()` will accept. Named, so nothing has to guess. */
export function permitsPrescribing(outcome: ConsultationOutcome | null): boolean {
  return outcome === 'completed'
}

/**
 * Where the route layer has mounted the room, and where it goes afterwards.
 *
 * PASSED IN RATHER THAN GUESSED, for the same two reasons as everywhere else: this domain
 * owns no routes, and a server action must never take its destination from the request.
 */
export type ConsultationPaths = {
  /** The room, for one appointment. */
  room: (appointmentId: string) => string
  /** Where the clinician goes when the encounter is over. The day view. */
  day: string
}
