import { findConsultationForAppointment, getAppointment, getPatient, listConsultations } from './consultations'
import { listMessages } from './messages'
import { listNotes } from './notes'
import { readRoomCredentials, type RoomCredentials } from './room'
import type { ConsultationMessage } from '../model/chat'
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
  /**
   * Inside — or reading back an encounter that is over.
   *
   * `credentials` IS NULLABLE AND THAT IS THE WHOLE POINT OF THIS BEING ONE STATE RATHER THAN
   * TWO. A clinician who ends a consultation, closes the tab, and comes back an hour later has
   * no room cookie any more and cannot be given one — `assertJoinable` refuses a completed
   * appointment, correctly. But they still need the screen: to add an addendum, and to issue
   * the prescription that only a COMPLETED consultation can carry.
   *
   * An earlier shape sent them to the door with a "Rejoin" button that would have answered
   * 403. Null credentials means the media pane is not drawn and everything else is, which is
   * exactly what is true.
   */
  | {
      readonly kind: 'open'
      readonly appointment: Appointment
      readonly patient: Patient | null
      readonly bookedMode: ConsultationMode | null
      /** Null when the encounter is over and there is no room left to be in. */
      readonly credentials: RoomCredentials | null
      /** Null until the clinician starts it, which the door does in the same action. */
      readonly consultation: Consultation | null
      readonly notes: readonly ClinicalNote[]
      /**
       * The chat transcript, or null when it could not be read.
       *
       * NULL IS NOT EMPTY. `[]` is "the patient has written nothing"; null is "we could not
       * read what they wrote", and a clinician answering the first when the second is true is
       * a clinician working blind on a screen that looks complete. The panel draws them
       * differently and `chatPanelState` decides which, in a function a test drives.
       *
       * NULL IS ALSO THE ORDINARY ANSWER FOR A COLLEAGUE'S CONSULTATION, and that is not a
       * bug. `ConsultationPolicy::participate` admits the patient and the clinician
       * conducting THIS encounter, and nobody else — narrower than the note's `view`, which
       * is clinic-wide. A covering clinician reading the record legitimately sees the notes
       * and legitimately cannot see the conversation.
       */
      readonly messages: readonly ConsultationMessage[] | null
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

  /*
   * IN THE ROOM, or reading back the record of an encounter that is over. The second case is
   * not a lesser version of the first: an addendum is a legitimate act after the fact and is
   * the only correction this product has, and a prescription can ONLY be issued once the
   * consultation has ended as completed — so the screen a clinician needs most is one they
   * reach with no room cookie at all.
   */
  const ended = consultation !== null && consultation.ended_at !== null

  if (credentials !== null || ended) {
    const notes = consultation === null ? [] : ((await listNotes(consultation.id)) ?? [])

    return {
      kind: 'open',
      appointment,
      patient,
      bookedMode,
      credentials,
      consultation,
      notes,
      /*
       * Loaded here with everything else, for the reason stated at the top of this function:
       * reads are audited, and `consultation_message.viewed` is one more event in a trail
       * that has to answer "who read my consultation" without a footnote about component
       * structure. A panel fetching its own would put two reads in the log for one screen.
       *
       * No consultation record means no transcript endpoint to call — the messages hang off
       * the consultation, not the appointment — and an empty list rather than null, because
       * "nothing has been written" is exactly true at that moment.
       */
      messages: consultation === null ? [] : await listMessages(consultation.id),
      history: await previousEncounters(appointment.patient_id, consultation?.id ?? null),
    }
  }

  // Terminal for the appointment with nothing recorded against it. There is no record to open
  // and `assertJoinable` would refuse a door, so the screen says so rather than offering one.
  if (status === 'completed' || status === 'abandoned') {
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
