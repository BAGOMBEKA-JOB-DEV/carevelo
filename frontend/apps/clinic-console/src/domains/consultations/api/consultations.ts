import { ApiError } from '@carevelo/api-client'
import { readingApi, writingApi } from './gateway'
import type {
  Appointment,
  Consultation,
  ConsultationMode,
  ConsultationOutcome,
  ConsultationsPage,
  Patient,
  RemoteMode,
} from '../model/types'

/**
 * The encounter itself: starting it, recording what mode it is really being held in, ending
 * it with an outcome, and reading what came before.
 *
 * EVERY CALL HERE RECORDS A FACT RATHER THAN DECIDING ONE. Carevelo does not conduct
 * consultations, judge outcomes or choose a mode — the clinician does, and this is the wire
 * that writes down what they did. That is not a slogan; it decides what this file is allowed
 * to contain. There is no "auto-detect the connection quality and step down" here, and there
 * will not be: a mode recorded by a heuristic is a clinical record written by a guess.
 *
 * A CROSS-TENANT ID IS A 404, NEVER A 403, and everything here passes that through untouched.
 *
 * @see backend/app/Http/Controllers/Api/V1/ConsultationController.php
 */

export type ConsultationOutcomeResult =
  | { kind: 'done'; consultation: Consultation }
  | { kind: 'problem'; message: string | null }

/** One appointment, or null when it is not this clinic's. */
export async function getAppointment(id: string): Promise<Appointment | null> {
  return orNull(async () => {
    const api = await readingApi()
    const response = await api.get<{ data: Appointment }>(
      `/v1/appointments/${encodeURIComponent(id)}`,
    )

    return response.data
  })
}

/** One patient of this clinic, or null. */
export async function getPatient(id: string): Promise<Patient | null> {
  return orNull(async () => {
    const api = await readingApi()
    const response = await api.get<{ data: Patient }>(`/v1/patients/${encodeURIComponent(id)}`)

    return response.data
  })
}

/**
 * The consultation held under this appointment, if one has been started.
 *
 * MATCHED CLIENT-SIDE, AND THAT IS A GAP WORTH NAMING RATHER THAN HIDING.
 * `IndexConsultationRequest` allows `patient_id`, `clinician_id`, `outcome`, `from` and `to`
 * — and NOT `appointment_id`. So there is no way to ask the question directly. What is asked
 * instead is this patient's consultations, newest first, and the row for this appointment is
 * picked out of the first page.
 *
 * WHY THAT IS EXACT IN PRACTICE. A consultation is created at the moment the clinician joins
 * and the list is ordered by `started_at` descending, so today's is on the first page of
 * twenty-five unless this patient has had twenty-five consultations since. It stops being
 * exact only for a patient with more than a page of LATER consultations, which cannot happen
 * inside one appointment's own window.
 *
 * An `appointment_id` filter is one line in that form request and would make it exact by
 * construction. It is in the handover notes.
 *
 * CURSOR PAGINATION, so no page number appears here. One page is fetched and no cursor is
 * followed: walking a patient's whole history to find today's encounter is a slow read for an
 * answer that is on the first page or is not the answer.
 */
export async function findConsultationForAppointment(
  appointmentId: string,
  patientId: string,
): Promise<Consultation | null> {
  const page = await listConsultations({ patientId, perPage: 25 })

  return page?.data.find((consultation) => consultation.appointment_id === appointmentId) ?? null
}

export type ConsultationQuery = {
  patientId?: string | undefined
  clinicianId?: string | undefined
  perPage?: number | undefined
  cursor?: string | undefined
}

/**
 * A page of consultations.
 *
 * CARRIES NO CLINICAL CONTENT AND NEVER HAS. `ConsultationResource` is who, when, in which
 * mode and with what outcome; the notes sit behind their own endpoint, which audits every
 * read of them separately. That is what makes it safe for this domain to fetch a patient's
 * history as context without every glance at a schedule counting as a read of their record.
 */
export async function listConsultations(
  query: ConsultationQuery = {},
): Promise<ConsultationsPage | null> {
  return orNull(async () => {
    const api = await readingApi()

    return api.get<ConsultationsPage>('/v1/consultations', {
      query: {
        patient_id: query.patientId,
        clinician_id: query.clinicianId,
        sort: '-started_at',
        per_page: query.perPage ?? 25,
        cursor: query.cursor,
      },
    })
  })
}

/**
 * Start the consultation: the clinician has joined.
 *
 * THE MODE IS OPTIONAL AND SAYING IT EARLY IS THE POINT. A clinician who already knows the
 * patient's connection will not carry video says so at the start rather than after a failed
 * attempt, and the appointment's `mode_booked` is left alone as the record of what was agreed.
 * Absent, the API takes the booked mode as the starting assumption.
 *
 * TWO FAILURES ARE ORDINARY AND BOTH COME BACK AS SENTENCES WORTH READING.
 * `ConsultationController::store` refuses an account that has a clinician ROLE but no
 * Clinician RECORD — "a clinical encounter is held by a practitioner registered with the
 * UMDPC, AHPC or the Nurses & Midwives Council and engaged by THIS clinic" — and it refuses a
 * second consultation on an appointment that already has one. Both are `IllegalTransition`
 * with the API's own words, which is why this returns the message rather than replacing it.
 */
export async function startConsultation(
  appointmentId: string,
  mode?: ConsultationMode | undefined,
): Promise<ConsultationOutcomeResult> {
  try {
    const api = await writingApi()
    const response = await api.post<{ data: Consultation }>('/v1/consultations', {
      appointment_id: appointmentId,
      ...(mode === undefined ? {} : { mode_used: mode }),
    })

    return { kind: 'done', consultation: response.data }
  } catch (error) {
    return { kind: 'problem', message: sentence(error) }
  }
}

/**
 * Record the mode the consultation is ACTUALLY being held in.
 *
 * ====================================================================================
 * THE STEP-DOWN IS RECORDED TRUTHFULLY, AND THE PATIENT IS TOLD
 * ====================================================================================
 *
 * A consultation booked as video and conducted over voice is stored as voice. Reporting the
 * booked mode instead would misstate the encounter clinically and would flatter us
 * commercially, which is exactly why the temptation exists.
 *
 * WHY THE CLINICIAN PRESSES THIS RATHER THAN A MONITOR DETECTING IT. Two reasons, and the
 * second is the one that matters. The video provider is unconfigured, so there is no
 * connection to measure — but even with one, a bandwidth heuristic deciding that an encounter
 * "was really voice" is a clinical record written by a guess. The clinician knows what
 * happened; the API records it.
 *
 * HOW THE PATIENT LEARNS OF IT: `mode_used` is on the consultation resource, the patient
 * portal reads it, and its ModeStrip renders the difference between what was booked and what
 * is being held. That is the whole degradation-is-announced mechanism, and this call is its
 * upstream half. A frozen frame with no explanation is what this exists to prevent.
 *
 * `in_person` IS NOT ACCEPTED, by the API and therefore by the type here. A remote
 * consultation does not become an in-person one by changing a field — the clinician ends it
 * with the outcome `converted_to_in_person`, which is a different act with a different and
 * permanent consequence.
 */
export async function recordMode(
  consultationId: string,
  mode: RemoteMode,
): Promise<ConsultationOutcomeResult> {
  try {
    const api = await writingApi()
    const response = await api.post<{ data: Consultation }>(
      `/v1/consultations/${encodeURIComponent(consultationId)}/mode`,
      { mode },
    )

    return { kind: 'done', consultation: response.data }
  } catch (error) {
    return { kind: 'problem', message: sentence(error) }
  }
}

/**
 * End it. An outcome is required, and the requirement is not paperwork.
 *
 * A consultation that simply stops records nothing about WHY, and the exception paths —
 * no-show, clinician unavailable, remote care judged unsafe, technical failure — are the ones
 * the clinic actually needs to count. `converted_to_in_person` additionally forbids any
 * prescription for ever, which is why it has to be captured at the moment the clinician
 * decides rather than inferred later from an empty note.
 *
 * ENDING IS IRREVERSIBLE. `ConsultationController::assertInProgress` refuses a second end
 * with the sentence that matters: "This consultation has already ended. Its record is closed;
 * a correction is made by addendum to its notes."
 */
export async function endConsultation(
  consultationId: string,
  outcome: ConsultationOutcome,
): Promise<ConsultationOutcomeResult> {
  try {
    const api = await writingApi()
    const response = await api.post<{ data: Consultation }>(
      `/v1/consultations/${encodeURIComponent(consultationId)}/end`,
      { outcome },
    )

    return { kind: 'done', consultation: response.data }
  } catch (error) {
    return { kind: 'problem', message: sentence(error) }
  }
}

/**
 * Everything about a consultation that would make the room render differently, as one short
 * string.
 *
 * This is what the live check compares, and it is deliberately NOT the consultation.
 * @carevelo/realtime's rule — a frame is a hint to re-fetch, never the thing itself — applies
 * just as well to a poll: the browser learns only THAT something moved, and the server
 * re-renders to say what it now is under the same authorisation as the first render. Nothing
 * clinical is in it and nothing here is rendered.
 */
export function roomSignature(consultation: Consultation | null, noteCount: number): string {
  if (consultation === null) {
    return `none|${noteCount}`
  }

  return [
    consultation.id,
    consultation.mode_used,
    consultation.outcome ?? '',
    consultation.ended_at ?? '',
    noteCount,
  ].join('|')
}

/**
 * Run a read, folding 404 and 403 into null.
 *
 * FOLDED TOGETHER ON PURPOSE. A record this clinic may not read has the same answer available
 * to it either way, and branching on the difference in the UI redraws one layer up exactly
 * the distinction the API refuses to draw — which is how you learn that a named person is a
 * patient of some other clinic.
 */
async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null
    }

    throw error
  }
}

function sentence(error: unknown): string | null {
  return error instanceof ApiError ? error.message : null
}
