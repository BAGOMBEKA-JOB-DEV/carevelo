import { ApiError } from '@carevelo/api-client'
import { readingApi, writingApi } from './gateway'
import type {
  Appointment,
  AppointmentsPage,
  AppointmentStatus,
  BookingBody,
  BookingProblem,
  ConsultationMode,
  PaymentExpectation,
} from '../model/types'

/**
 * Reading, making, cancelling and confirming the clinic's bookings.
 *
 * WHAT STAFF ARE SHOWN IS NOT DECIDED HERE, AND CANNOT BE. `GET /v1/appointments`
 * authorises and narrows in one call — `AuthorisesPatientReads` sends a patient down the
 * branch that also adds their own `patient_id` filter, and clinical staff down the branch
 * that returns the clinic's rows under row-level security. There is no query this file
 * could write that would return another clinic's appointments. That is worth knowing when
 * reading the functions below: they pass no tenant filter because the filter is not theirs
 * to pass, and adding one would suggest, wrongly, that it is what protects the data.
 *
 * A CROSS-TENANT ID IS A 404, NEVER A 403, and everything here passes that through
 * untouched. The distinction is the disclosure: a 403 would confirm the record exists
 * somewhere, which is how you learn that a named person is a patient of some other clinic.
 * No caller may "helpfully" explain the difference either.
 *
 * @see backend/app/Http/Controllers/Api/V1/AppointmentController.php
 */

export type AppointmentQuery = {
  /** `YYYY-MM-DD`. Filters on `scheduled_start_at`; the API takes the whole day. */
  from?: string | undefined
  to?: string | undefined
  clinicianId?: string | undefined
  status?: AppointmentStatus | undefined
  /** Ascending by default, which is how a day reads. */
  newestFirst?: boolean | undefined
  cursor?: string | undefined
  perPage?: number | undefined
}

/**
 * A page of the clinic's appointments.
 *
 * CURSOR, NOT OFFSET. The front desk is booking into the same table while a clinician pages
 * through it, and that is precisely the traffic under which an offset duplicates and skips
 * rows. A skipped row here is an appointment nobody attends.
 */
export async function listAppointments(query: AppointmentQuery = {}): Promise<AppointmentsPage> {
  const api = await readingApi()

  return api.get<AppointmentsPage>('/v1/appointments', {
    query: {
      from: query.from,
      to: query.to,
      clinician_id: query.clinicianId,
      status: query.status,
      sort: query.newestFirst ? '-scheduled_start_at' : 'scheduled_start_at',
      cursor: query.cursor,
      // A clinic day is tens of appointments, not hundreds. 100 is the API's maximum and
      // asking for it means a day view is one round trip rather than a cursor walk that
      // could show a half-day and call it a day.
      per_page: query.perPage ?? 100,
    },
  })
}

/** One appointment, or null when it is not this clinic's. */
export async function getAppointment(id: string): Promise<Appointment | null> {
  try {
    const api = await readingApi()
    const response = await api.get<{ data: Appointment }>(
      `/v1/appointments/${encodeURIComponent(id)}`,
    )

    return response.data
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      // Folded together on purpose. Whichever it was, this console has the same answer
      // available to it, and branching on the difference in the UI redraws one layer up
      // exactly the distinction the API refuses to draw.
      return null
    }

    throw error
  }
}

/** What a booking attempt did, with no exception left for the caller to interpret. */
export type BookingOutcome =
  | { kind: 'booked'; appointment: Appointment }
  | { kind: 'problem'; problem: BookingProblem; message: string | null }

export type BookingRequest = {
  patientId: string
  clinicianId: string
  serviceId: string
  /** The slot's `starts_at`, exactly as availability gave it. */
  startsAt: string
  mode: ConsultationMode
  paymentExpectation: PaymentExpectation
}

/**
 * Book a slot on a patient's behalf.
 *
 * THIS IS THE PRIMARY BOOKING PATH, not an administrative fallback. The PRD expects most
 * bookings in the first year to be made this way — a patient telephones, a receptionist
 * types. The screen that calls this is built for somebody doing it forty times a day with a
 * handset against their shoulder, which is why it is keyboard-first and why nothing in it
 * needs a mouse.
 *
 * NO `scheduled_end_at`. It is optional, and when absent the end comes from the service's
 * own `duration_minutes` — which is where the clinic already maintains it. A client that
 * computed the end itself would be a second copy of the clinic's slot length, and the day
 * the clinic shortens a consultation the two would disagree.
 *
 * NO IDEMPOTENCY KEY, DELIBERATELY. `ApiClient` will set one on request and this endpoint
 * stores none, so it would be decoration. What actually stops a double tap becoming two
 * appointments is the slot check inside the booking transaction: the first booking holds
 * the slot — `awaiting_payment` counts — so the second is refused as taken, which is the
 * same answer a receptionist would get if a colleague had been quicker.
 *
 * THE SLOT RACE IS AN OUTCOME, NOT AN ERROR. `AppointmentController::store` throws a
 * validation error keyed on `scheduled_start_at` when the slot went while the caller was
 * being asked which day suits them, and that is the one 422 named specially below: the
 * screen's response to it is not an apology, it is a fresh list of times.
 */
export async function bookAppointment(request: BookingRequest): Promise<BookingOutcome> {
  // Typed as the generated request schema, so an added or renamed field on the contract
  // stops this compiling rather than being silently rejected — `BookingRequest::
  // rejectUnknownFields()` refuses anything it does not recognise.
  const body: BookingBody = {
    patient_id: request.patientId,
    clinician_id: request.clinicianId,
    service_id: request.serviceId,
    scheduled_start_at: request.startsAt,
    mode_booked: request.mode,
    payment_expectation: request.paymentExpectation,
  }

  try {
    const api = await writingApi()
    const response = await api.post<{ data: Appointment }>('/v1/appointments', body)

    return { kind: 'booked', appointment: response.data }
  } catch (error) {
    return { kind: 'problem', ...diagnose(error) }
  }
}

export type WriteOutcome =
  | { kind: 'done'; appointment: Appointment }
  | { kind: 'problem'; message: string | null }

/**
 * Cancel, releasing the slot immediately.
 *
 * A REASON IS REQUIRED BY THE API, three characters minimum. It is stored on the
 * appointment and deliberately NEVER copied into the audit trail, because free text typed
 * at a front desk routinely names a condition — "her malaria cleared up" is a diagnosis.
 * The form that collects it says so, in those words, because a receptionist who does not
 * know that will write one.
 */
export async function cancelAppointment(id: string, reason: string): Promise<WriteOutcome> {
  try {
    const api = await writingApi()
    const response = await api.post<{ data: Appointment }>(
      `/v1/appointments/${encodeURIComponent(id)}/cancel`,
      { reason },
    )

    return { kind: 'done', appointment: response.data }
  } catch (error) {
    return { kind: 'problem', message: sentence(error) }
  }
}

/**
 * Confirm an unpaid booking on the clinic's authority.
 *
 * ADMINISTRATOR ONLY, and the restriction is the point rather than an inconvenience.
 * `AppointmentPolicy::confirmDeferred` admits `clinic_admin` and nobody else, because this
 * is somebody vouching that a patient will settle at the desk — or that the clinic has seen
 * a mobile-money transfer that Carevelo has not. An unaudited way to mark something paid is
 * an invitation, so every call writes `appointment.confirmed_deferred` naming the person
 * who made it.
 *
 * IT CAN LEGITIMATELY FAIL, AND THE FAILURE IS WORTH READING. The controller re-checks the
 * slot: a confirmed appointment may have taken this clinician's time while this one sat
 * unpaid, and confirming into it would double-book. That comes back as an
 * `IllegalTransition` with a sentence naming the remedy — rebook the patient — which is
 * passed through verbatim rather than replaced with "something went wrong".
 */
export async function confirmDeferred(id: string): Promise<WriteOutcome> {
  try {
    const api = await writingApi()
    const response = await api.post<{ data: Appointment }>(
      `/v1/appointments/${encodeURIComponent(id)}/confirm-deferred`,
    )

    return { kind: 'done', appointment: response.data }
  } catch (error) {
    return { kind: 'problem', message: sentence(error) }
  }
}

/**
 * Which of the five things went wrong.
 *
 * `403` IS ITS OWN CASE. `AppointmentPolicy::create()` delegates to `viewAny()`, whose role
 * list is administrator, clinician and front desk — so a pharmacist or a dispatcher who
 * reaches this screen gets a refusal that is correct and needs to read as "not your job"
 * rather than as a fault.
 */
function diagnose(error: unknown): { problem: BookingProblem; message: string | null } {
  if (!(error instanceof ApiError)) {
    return { problem: 'failed', message: null }
  }

  if (error.status === 403) {
    return { problem: 'refused', message: null }
  }

  if (error.status === 422) {
    // The controller's own words: "This slot is no longer available." Keyed on the field the
    // receptionist chose, which is what makes it distinguishable from every other 422.
    const taken = error.fieldErrors['scheduled_start_at'] !== undefined

    return { problem: taken ? 'slot_taken' : 'invalid', message: taken ? null : error.message }
  }

  return { problem: 'failed', message: error.message }
}

function sentence(error: unknown): string | null {
  return error instanceof ApiError ? error.message : null
}
