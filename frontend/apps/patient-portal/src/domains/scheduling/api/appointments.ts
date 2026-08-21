import { ApiError } from '@carevelo/api-client'
import { readClient, writeClient } from './http'
import type {
  Appointment,
  AppointmentsPage,
  BookingBody,
  BookingProblem,
  ConsultationMode,
  PaymentExpectation,
} from '../model/types'

/**
 * Reading, making and cancelling bookings.
 *
 * WHAT THE PATIENT IS SHOWN IS NOT DECIDED HERE, AND CANNOT BE. `GET /v1/appointments`
 * authorises and NARROWS in one call — `AuthorisesPatientReads` lets a patient through
 * only on the branch that also adds the `patient_id` filter — so there is no query this
 * file could write that would return another patient's rows. That is worth knowing when
 * reading the list functions below: they pass no ownership filter because the filter is
 * not theirs to pass, and adding one would suggest, wrongly, that it is what protects the
 * data.
 *
 * @see backend/app/Http/Controllers/Api/V1/AppointmentController.php
 */

export type AppointmentQuery = {
  /** `YYYY-MM-DD`. Filters on `scheduled_start_at`, inclusive. */
  from?: string | undefined
  to?: string | undefined
  /** Ascending by default; `true` for the most recent first, which is how a past list reads. */
  newestFirst?: boolean | undefined
  cursor?: string | undefined
}

/**
 * A page of the patient's own appointments.
 *
 * CURSOR, NOT OFFSET. The clinic is booking into the same table while a patient pages
 * through it, and that is precisely the traffic under which an offset duplicates and
 * skips rows.
 */
export async function listAppointments(query: AppointmentQuery = {}): Promise<AppointmentsPage> {
  const client = await readClient()

  return client.get<AppointmentsPage>('/v1/appointments', {
    query: {
      from: query.from,
      to: query.to,
      sort: query.newestFirst ? '-scheduled_start_at' : 'scheduled_start_at',
      cursor: query.cursor,
    },
  })
}

/**
 * One appointment.
 *
 * A CROSS-TENANT OR CROSS-PATIENT ID IS A 404, NOT A 403, and this function passes that
 * through untouched. The distinction is the disclosure: a 403 would confirm the record
 * exists somewhere, which is how you learn that a named person is a patient of some other
 * clinic. Callers must not "helpfully" explain the difference either.
 */
export async function getAppointment(id: string): Promise<Appointment> {
  const client = await readClient()
  const response = await client.get<{ data: Appointment }>(`/v1/appointments/${id}`)

  return response.data
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
 * Book a slot.
 *
 * NO `scheduled_end_at`. It is optional, and when it is absent the end comes from the
 * service's own `duration_minutes` — which is where the clinic already maintains it. A
 * client that computed the end itself would be a second copy of the clinic's slot length,
 * and the day the clinic shortens a consultation the two would disagree.
 *
 * NO IDEMPOTENCY KEY, DELIBERATELY. `ApiClient` will set one on request and this endpoint
 * stores none, so it would be decoration. What actually stops a double tap becoming two
 * appointments is the slot check inside the booking transaction: the first booking holds
 * the slot — `awaiting_payment` counts — so the second is refused as taken, which is the
 * same answer the patient would get if a stranger had been quicker. (Payments are a
 * different matter entirely, and `PaymentIntentController` requires a key for exactly the
 * reason this endpoint does not need one.)
 *
 * THE SLOT RACE IS AN OUTCOME, NOT AN ERROR. `AppointmentController::store` throws a
 * validation error keyed on `scheduled_start_at` when the slot went while the patient was
 * choosing, and that is the one 422 this function names specially, because the screen's
 * response to it is not an apology — it is a fresh list of times.
 */
export async function bookAppointment(request: BookingRequest): Promise<BookingOutcome> {
  // Typed as the generated request schema, so an added or renamed field on the contract
  // stops this compiling rather than being silently rejected as an unknown field —
  // `BookingRequest::rejectUnknownFields()` refuses anything it does not recognise.
  const body: BookingBody = {
    patient_id: request.patientId,
    clinician_id: request.clinicianId,
    service_id: request.serviceId,
    scheduled_start_at: request.startsAt,
    mode_booked: request.mode,
    payment_expectation: request.paymentExpectation,
  }

  try {
    const client = await writeClient()
    const response = await client.post<{ data: Appointment }>('/v1/appointments', body)

    return { kind: 'booked', appointment: response.data }
  } catch (error) {
    return { kind: 'problem', ...diagnose(error) }
  }
}

export type CancellationOutcome =
  | { kind: 'cancelled'; appointment: Appointment }
  | { kind: 'problem'; message: string | null }

/**
 * Cancel, releasing the slot immediately.
 *
 * THE PATIENT MAY DO THIS AND SHOULD. `AppointmentPolicy::cancel` admits the patient
 * whose appointment it is, and the reasoning in the policy is the product reasoning: a
 * patient who cannot cancel telephones the clinic instead, and a slot nobody released is
 * a slot nobody else could book.
 *
 * A REASON IS REQUIRED BY THE API, three characters minimum. It is stored on the
 * appointment and deliberately never copied into the audit trail, because free text typed
 * by a patient routinely names a condition. The form that collects it says so.
 */
export async function cancelAppointment(id: string, reason: string): Promise<CancellationOutcome> {
  try {
    const client = await writeClient()
    const response = await client.post<{ data: Appointment }>(`/v1/appointments/${id}/cancel`, {
      reason,
    })

    return { kind: 'cancelled', appointment: response.data }
  } catch (error) {
    return { kind: 'problem', message: sentence(error) }
  }
}

/**
 * Which of the five things went wrong.
 *
 * `403` IS ITS OWN CASE FOR A REASON THE READER SHOULD KNOW ABOUT.
 * `AppointmentPolicy::create()` currently delegates to `viewAny()`, whose role list is
 * administrator, clinician and front desk — the PATIENT IS NOT ON IT — while
 * `docs/50-security-compliance/rbac-matrix.md` records "Appointment — book" as `own` for
 * the patient column. Until those agree, a patient pressing Confirm receives a 403, and
 * the honest thing to show is not "something went wrong" but the clinic's telephone
 * number: the PRD expects most first-year bookings to be made by front desk anyway, so
 * telephoning is a real route to care rather than a consolation.
 */
function diagnose(error: unknown): { problem: BookingProblem; message: string | null } {
  if (!(error instanceof ApiError)) {
    return { problem: 'failed', message: null }
  }

  if (error.status === 403) {
    return { problem: 'refused', message: null }
  }

  if (error.status === 422) {
    // The controller's own words: "This slot is no longer available." Keyed on the field
    // the patient chose, which is what makes it distinguishable from every other 422.
    const taken = error.fieldErrors['scheduled_start_at'] !== undefined

    return { problem: taken ? 'slot_taken' : 'invalid', message: taken ? null : error.message }
  }

  return { problem: 'failed', message: error.message }
}

function sentence(error: unknown): string | null {
  return error instanceof ApiError ? error.message : null
}
