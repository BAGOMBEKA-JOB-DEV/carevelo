import { ApiError, type components, type operations } from '@carevelo/api-client'
import { readingApi } from './gateway'
import { readRoomCredentials, type RoomCredentials } from './room'

/**
 * Reading the booking and the encounter, and deciding which of the two screens the
 * patient is actually on.
 *
 * THE DECISION IS MADE HERE, NOT IN THE ROUTE. `src/app` composes and renders; a route
 * file that worked out whether an appointment may be joined would be business logic in
 * the routing tree, where nothing looks for it and no other surface can reuse it.
 *
 * WHY THE PORTAL DECIDES JOINABILITY AT ALL, given the API decides it too. Two reasons,
 * and the second is the real one.
 *
 *   1. The API refuses an un-joinable appointment with an AuthorizationException, and
 *      bootstrap/app.php renders EVERY AuthorizationException as the same problem
 *      document: 403, "You do not have permission to do that". The controller's careful
 *      sentences — "This appointment cannot be joined", "This appointment has finished" —
 *      never reach the wire. So a portal that relied on the API's answer could only tell
 *      the patient that they lack permission to join their own consultation, which is
 *      both wrong and alarming.
 *   2. Sending somebody into a room and refusing them at the door is worse than not
 *      offering the door. The button is only rendered when the booking can plausibly be
 *      entered.
 *
 * NONE OF THIS IS THE SECURITY BOUNDARY, and it must not be read as one. The API decides
 * who gets a token, under the appointment policy and row-level security; this decides
 * what to render. A patient who edits their way past everything here still meets that.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md §4 and the exception paths
 */

export type Appointment = components['schemas']['AppointmentResource']
export type Consultation = components['schemas']['ConsultationResource']
export type ConsultationMode = components['schemas']['ConsultationMode']
export type ConsultationOutcome = components['schemas']['ConsultationOutcome']

/*
 * The enum values, as values.
 *
 * `satisfies` ties each list to the generated enum, so a mode or an outcome added to the
 * contract breaks this build rather than falling silently through a switch into a generic
 * sentence. The resources type `mode_used` and `outcome` as bare strings — Scramble cannot
 * see through the cast on the model — so a narrowing step is needed either way, and this
 * is the one place it happens.
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
 * How long before the slot the room opens.
 *
 * A PORTAL DECISION, NOT THE API'S. JoinTokenController::assertJoinable gates on status
 * and on the far end of the window; it does not gate on earliness, so nothing server-side
 * stops a patient entering an empty room a week ahead. Fifteen minutes is a lead, not a
 * lock — an appointment the clinician has already started is `in_progress` and opens
 * immediately regardless, which is what keeps this from blocking a clinic that runs early.
 */
const OPENS_MINUTES_BEFORE = 15

/**
 * How long after the slot the room stays open.
 *
 * Mirrors JoinToken::GRACE_MINUTES. If that constant moves, this one is wrong and the
 * symptom is a button that produces a flat 403 — so it is named here rather than left as
 * a number.
 */
const GRACE_MINUTES = 30

/**
 * Which screen the patient is on.
 *
 * A closed union rather than a bag of booleans: every state carries exactly what its
 * screen needs, and a screen cannot render half-initialised because the compiler will not
 * let it read a field the state does not have.
 */
export type ConsultationEntry =
  /** The lobby, with the door open. */
  | { readonly kind: 'lobby'; readonly appointment: Appointment; readonly bookedMode: ConsultationMode | null }
  /** The lobby, before the room opens. */
  | {
      readonly kind: 'not-open-yet'
      readonly appointment: Appointment
      readonly bookedMode: ConsultationMode | null
      /** ISO-8601 UTC. Formatted by the caller — see DateTime in @carevelo/ui. */
      readonly opensAt: string
    }
  /** Booked but not yet confirmed: nothing to join. */
  | { readonly kind: 'not-confirmed'; readonly appointment: Appointment }
  /** Held, or past its window. The record is what remains. */
  | { readonly kind: 'finished'; readonly appointment: Appointment }
  /** Cancelled, missed or expired. */
  | { readonly kind: 'closed'; readonly appointment: Appointment }
  /** Inside. */
  | {
      readonly kind: 'room'
      readonly appointment: Appointment
      readonly bookedMode: ConsultationMode | null
      readonly credentials: RoomCredentials
      /** Null until the clinician starts it — which is the ordinary case on arrival. */
      readonly consultation: Consultation | null
    }

/**
 * Load everything the entry screens need, in as few round trips as the contract allows.
 *
 * Returns null when the appointment is not this patient's, which the API answers as a
 * 404 whether it never existed or belongs to another clinic. The caller renders the
 * portal's own not-found; the distinction is deliberately not available to it.
 */
export async function loadConsultationEntry(appointmentId: string): Promise<ConsultationEntry | null> {
  const appointment = await readAppointment(appointmentId)

  if (appointment === null) {
    return null
  }

  const bookedMode = asMode(appointment.mode_booked)
  const status = appointment.status

  // Cancelled, missed, expired: there is no room and there never will be for this
  // booking. Checked before the remembered entry, so a patient holding a stale cookie
  // for a cancelled appointment is told it was cancelled rather than shown a room.
  if (status === 'cancelled' || status === 'no_show' || status === 'expired') {
    return { kind: 'closed', appointment }
  }

  if (status === 'awaiting_payment' || status === 'payment_failed') {
    return { kind: 'not-confirmed', appointment }
  }

  const credentials = await readRoomCredentials(appointmentId)

  if (credentials !== null) {
    // Inside already. The consultation may not exist yet — the clinician creates it when
    // they join — and the room renders that state honestly rather than hiding it.
    return {
      kind: 'room',
      appointment,
      bookedMode,
      credentials,
      consultation: await findConsultationForAppointment(appointmentId),
    }
  }

  if (status === 'completed' || status === 'abandoned') {
    return { kind: 'finished', appointment }
  }

  const now = Date.now()
  const startsAt = Date.parse(appointment.scheduled_start_at)
  const endsAt = Date.parse(appointment.scheduled_end_at)

  // A slot whose end the API could not give us is treated as open rather than closed. An
  // unparseable date is our problem; locking a patient out of a paid consultation over it
  // is not a reasonable way to report it.
  if (Number.isFinite(endsAt) && now > endsAt + GRACE_MINUTES * 60_000) {
    return { kind: 'finished', appointment }
  }

  // `in_progress` means the clinician has already started, so the lead time is moot.
  if (
    status !== 'in_progress'
    && Number.isFinite(startsAt)
    && now < startsAt - OPENS_MINUTES_BEFORE * 60_000
  ) {
    return {
      kind: 'not-open-yet',
      appointment,
      bookedMode,
      opensAt: new Date(startsAt - OPENS_MINUTES_BEFORE * 60_000).toISOString(),
    }
  }

  return { kind: 'lobby', appointment, bookedMode }
}

/**
 * One appointment, or null when it is not this patient's.
 *
 * 403 is folded into null alongside 404 on purpose. A patient reaching an appointment
 * they may not read has the same answer available to them either way, and branching on
 * the difference in the UI is how the distinction the API refuses to draw gets redrawn
 * one layer up.
 */
async function readAppointment(appointmentId: string): Promise<Appointment | null> {
  try {
    const api = await readingApi()
    const response = await api.get<
      operations['v1.appointments.show']['responses'][200]['content']['application/json']
    >(`/v1/appointments/${encodeURIComponent(appointmentId)}`)

    return response.data
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null
    }

    throw error
  }
}

/**
 * The consultation held under this appointment, if the clinician has started one.
 *
 * MATCHED CLIENT-SIDE, AND THAT IS A GAP WORTH NAMING. IndexConsultationRequest allows
 * `patient_id`, `clinician_id`, `outcome`, `from` and `to`, but not `appointment_id`, so
 * there is no way to ask the question directly. What is asked instead is the patient's own
 * list — the API narrows it to their own rows, this is not a filter we could omit — newest
 * first, and the row for this appointment is picked out of it.
 *
 * That is exact in practice rather than by construction: the list is ordered by
 * `started_at` descending, and a consultation the patient is currently sitting in is the
 * most recent one that exists. It would stop being exact only for a patient with more than
 * a page of consultations started AFTER this one, which is not a thing that happens inside
 * one appointment's window. An `appointment_id` filter would make it exact by construction
 * and is one line in that form request; it is in the handover notes.
 *
 * CURSOR PAGINATION, so no page number appears here. One page is fetched and no cursor is
 * followed: walking the whole history to find today's consultation would be a slow read on
 * a handset for an answer that is on the first page or is not the answer.
 */
export async function findConsultationForAppointment(
  appointmentId: string,
): Promise<Consultation | null> {
  try {
    const api = await readingApi()
    const response = await api.get<
      operations['v1.consultations.index']['responses'][200]['content']['application/json']
    >('/v1/consultations', { query: { per_page: 25, sort: '-started_at' } })

    return response.data.find((consultation) => consultation.appointment_id === appointmentId) ?? null
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null
    }

    throw error
  }
}

/**
 * Everything about a consultation that would make the room render differently, as one
 * short string.
 *
 * This is what the live check compares, and it is deliberately not the consultation
 * itself. @carevelo/realtime's rule — a frame is a hint to re-fetch, never the thing
 * itself — applies just as well to a poll: the browser learns only THAT something moved,
 * and the server component re-renders to say what it now is, under the same authorisation
 * as the first render. Nothing clinical is in it, and nothing here is rendered.
 */
export function roomSignature(consultation: Consultation | null): string {
  if (consultation === null) {
    return 'none'
  }

  return [
    consultation.id,
    consultation.mode_used,
    consultation.outcome ?? '',
    consultation.ended_at ?? '',
  ].join('|')
}
