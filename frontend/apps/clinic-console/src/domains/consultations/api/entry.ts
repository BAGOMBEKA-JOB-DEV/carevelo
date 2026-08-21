import { findConsultationForAppointment, getAppointment, getPatient, listConsultations } from './consultations'
import { listNotes } from './notes'
import { readRoomCredentials, type RoomCredentials } from './room'
import { asMode, type Appointment, type ClinicalNote, type Consultation, type ConsultationMode, type Patient } from '../model/types'

/**
 * Which screen the clinician is actually on, decided here and NOT in the route.
 *
 * `src/app` composes and renders. A route file that worked out whether an appointment may be
 * entered would be business logic in the routing tree, where nothing looks for it and no
 * other surface can reuse it — and `.dependency-cruiser.cjs` enforces that direction.
 *
 * ------------------------------------------------------------------------------------
 * WHY THE CONSOLE DECIDES JOINABILITY AT ALL, GIVEN THE API DECIDES IT TOO
 *
 * Two reasons, and the second is the real one.
 *
 *   1. The API refuses an un-joinable appointment with an `AuthorizationException`, and
 *      bootstrap/app.php flattens EVERY AuthorizationException to the same problem document:
 *      403, "You do not have permission to do that". `JoinTokenController`'s careful
 *      sentences — "This appointment cannot be joined", "This appointment has finished" —
 *      never reach the wire. A console that relied on the API's answer could only tell a
 *      clinician they lack permission to hold their own consultation, which is both wrong and
 *      alarming.
 *   2. Offering a door and refusing somebody at it is worse than not offering the door.
 *
 * NONE OF THIS IS THE SECURITY BOUNDARY and it must not be read as one. `AppointmentPolicy::
 * join` decides who gets a token, under row-level security; this decides what to draw. A
 * clinician who edits their way past everything here still meets that.
 */

/** A closed union: every state carries exactly what its screen needs and nothing else. */
export type RoomState =
  /** Not this clinic's appointment, or not readable. The route renders its own not-found. */
  | { readonly kind: 'unavailable' }
  /** There is no room and there will not be one for this booking. */
  | {
      readonly kind: 'closed'
      readonly appointment: Appointment
      readonly patient: Patient | null
      readonly reason: 'not-confirmed' | 'cancelled' | 'finished'
    }
  /** May be entered, and has not been. The consultation may or may not already exist. */
  | {
      readonly kind: 'door'
      readonly appointment: Appointment
      readonly patient: Patient | null
      readonly bookedMode: ConsultationMode | null
      readonly consultation: Consultation | null
      /** The patient's previous encounters at THIS clinic. Never anywhere else. */
      readonly history: readonly Consultation[]
    }
  /** Inside. */
  | {
      readonly kind: 'open'
      readonly appointment: Appointment
      readonly patient: Patient | null
      readonly bookedMode: ConsultationMode | null
      readonly credentials: RoomCredentials
      /** Null until the clinician starts it, which the door does in the same action. */
      readonly consultation: Consultation | null
      readonly notes: readonly ClinicalNote[]
      readonly history: readonly Consultation[]
    }

/**
 * Load everything the room needs, in as few round trips as the contract allows.
 *
 * READS ARE AUDITED AND THAT IS WHY THIS IS ONE FUNCTION. `consultation.list_read`,
 * `consultation.viewed` and `clinical_note.viewed` each write an audit event. Fetching the
 * same things from four components would put four reads in the trail for one screen, and "who
 * looked at my record" is a question that has to be answerable without a footnote about
 * component structure.
 */
export async function loadRoom(appointmentId: string): Promise<RoomState> {
  const appointment = await getAppointment(appointmentId)

  if (appointment === null) {
    return { kind: 'unavailable' }
  }

  const patient = await getPatient(appointment.patient_id)
  const bookedMode = asMode(appointment.mode_booked)
  const status = appointment.status

  /*
   * Cancelled, missed or expired: checked BEFORE the remembered entry, so a clinician holding
   * a stale cookie for a cancelled appointment is told it was cancelled rather than shown a
   * room. The cookie is a memory of an entry, not a right to one.
   */
  if (status === 'cancelled' || status === 'no_show' || status === 'expired') {
    return { kind: 'closed', appointment, patient, reason: 'cancelled' }
  }

  if (status === 'awaiting_payment' || status === 'payment_failed') {
    return { kind: 'closed', appointment, patient, reason: 'not-confirmed' }
  }

  const credentials = await readRoomCredentials(appointmentId)
  const consultation = await findConsultationForAppointment(appointmentId, appointment.patient_id)

  if (credentials !== null) {
    const notes = consultation === null ? [] : ((await listNotes(consultation.id)) ?? [])

    return {
      kind: 'open',
      appointment,
      patient,
      bookedMode,
      credentials,
      consultation,
      notes,
      history: await previousEncounters(appointment.patient_id, consultation?.id ?? null),
    }
  }

  /*
   * `completed` and `abandoned` are terminal for the APPOINTMENT, but the consultation's
   * record is still worth opening — an addendum to a note is a legitimate act after the fact,
   * and it is the only correction mechanism this product has. So a finished appointment with
   * a consultation lands at the door rather than at a dead end; the door screen offers the
   * record and not a join button, because `assertJoinable` would refuse one.
   */
  if ((status === 'completed' || status === 'abandoned') && consultation === null) {
    return { kind: 'closed', appointment, patient, reason: 'finished' }
  }

  return {
    kind: 'door',
    appointment,
    patient,
    bookedMode,
    consultation,
    history: await previousEncounters(appointment.patient_id, consultation?.id ?? null),
  }
}

/**
 * THE PATIENT'S HISTORY WITHIN THIS TENANT, AND THE PHRASE IS LOAD-BEARING.
 *
 * `GET /v1/consultations?patient_id=` runs under row-level security and
 * `AuthorisesPatientReads`, so what comes back is this clinic's encounters with this person
 * and nothing else. There is no cross-clinic patient history in this product and there will
 * not be one: the isolation boundary between clinics is absolute, and a clinician here has no
 * standing to read what a clinic across town recorded.
 *
 * That is a real clinical limitation and the screen says so rather than presenting a partial
 * history as a whole one. A clinician who assumes this list is everything the patient has ever
 * been seen for will make a decision on it.
 *
 * WHAT IS IN IT AND WHAT IS NOT: `ConsultationResource` carries who, when, in which mode and
 * with what outcome — no clinical content at all. The notes of a past encounter are a separate,
 * separately-audited read, which is why this returns encounters and the component links to
 * them rather than inlining them.
 *
 * TODAY'S ENCOUNTER IS EXCLUDED, because it is the screen the clinician is already on.
 */
async function previousEncounters(
  patientId: string,
  excludeId: string | null,
): Promise<readonly Consultation[]> {
  const page = await listConsultations({ patientId, perPage: 10 })

  if (page === null) {
    return []
  }

  return page.data.filter((consultation) => consultation.id !== excludeId)
}
