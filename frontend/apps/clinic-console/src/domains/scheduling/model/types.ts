import type { components, operations } from '@carevelo/api-client'

/**
 * Every shape this domain handles, taken from the generated contract.
 *
 * NOT ONE OF THESE IS HAND-WRITTEN, and the rule is not stylistic. A hand-written response
 * interface is a second copy of the contract that nothing checks: it drifts the first time
 * the API adds a field, goes on compiling, and the screen renders `undefined`.
 * `packages/api-client/src/generated/schema.d.ts` is generated from docs/40-api/openapi.yaml
 * and committed, so the day a field changes there every call site in this folder stops
 * compiling — which is the entire point.
 *
 * THE SLOT AND THE PAGE HAVE NO NAMED SCHEMA, so they are reached through `operations`
 * rather than `components`. The availability endpoint describes its response inline and the
 * cursor page is Laravel's own envelope; both are still the contract, and indexing into the
 * operation is how you take them from it rather than retyping them here.
 */

export type Appointment = components['schemas']['AppointmentResource']
export type AppointmentStatus = components['schemas']['AppointmentStatus']

/** A bookable offering, priced by the clinic that offers it. */
export type Service = components['schemas']['ServiceResource']

/**
 * A clinician as the CATALOGUE describes them: name, specialty, photo.
 *
 * THE REGISTRATION NUMBER IS NOT ON THIS TYPE. `ClinicianResource` omits it permanently
 * because the endpoint is patient-facing — an endpoint every patient of every clinic can
 * reach would otherwise be a harvestable list of practitioner credentials to impersonate.
 * The prescribing surface needs it and gets it from a different, administrator-only
 * endpoint; see the prescriptions domain, which has a long note about what that costs.
 */
export type Clinician = components['schemas']['ClinicianResource']

/** A patient, as staff of this clinic may read them. */
export type Patient = components['schemas']['PatientResource']

/**
 * in_person | video | voice | chat.
 *
 * VOICE AND CHAT ARE FIRST-CLASS BOOKABLE MODES, not degraded fallbacks. A patient on a
 * poor connection — which in this market is a large share of them at any moment — must be
 * able to choose voice deliberately rather than fight a failing video call. Everything in
 * this domain that offers a mode offers the four as equals: same control, same weight,
 * same amount of explanation.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md §1
 */
export type ConsultationMode = components['schemas']['ConsultationMode']

/** The booking body, exactly as POST /v1/appointments accepts it. */
export type BookingBody = components['schemas']['StoreAppointmentRequest']

/** `prepaid` or `pay_at_clinic`. There is no third option. */
export type PaymentExpectation = BookingBody['payment_expectation']

type AvailabilityResponse =
  operations['v1.availability.index']['responses'][200]['content']['application/json']

/**
 * One offered slot.
 *
 * ADVISORY, ALWAYS. `AvailabilityController` computes these from the clinic's working hours
 * minus busy periods and says so in as many words: booking re-checks the slot inside a
 * transaction, because two members of staff can read the same free slot a millisecond
 * apart. A screen that treats a slot as a reservation is a screen that shows a receptionist
 * an error page for something that is not their fault and is not a fault at all.
 */
export type Slot = AvailabilityResponse['data'][number]

/** What the availability answer says about itself — the window it actually covered. */
export type AvailabilityMeta = AvailabilityResponse['meta']

/**
 * A page of appointments.
 *
 * CURSOR, NOT OFFSET, as the API conventions require. An offset page duplicates and skips
 * rows while the front desk is booking beside you, and a skipped row on a day view is an
 * appointment a clinician never sees.
 */
export type AppointmentsPage =
  operations['v1.appointments.index']['responses'][200]['content']['application/json']

/**
 * Where the route layer has mounted the screens this domain exports.
 *
 * PASSED IN RATHER THAN GUESSED. This domain owns no routes and must not assume the URLs it
 * lives at — a hard-coded `/schedule` here is a domain that cannot be moved or mounted
 * twice. More to the point: every server action redirect is built from this object rather
 * than from anything the form posted, so an action can never be talked into sending a
 * member of staff somewhere a hidden field chose.
 */
export type SchedulePaths = {
  /** Where `<DayView>` is mounted. Reads `?day=&clinician=&problem=&message=`. */
  day: string
  /** Where `<AssistedBooking>` is mounted. Reads `?patient=&service=&clinician=&day=&problem=&message=`. */
  book: string
  /**
   * Where the consultation room is mounted, given an appointment id.
   *
   * A FUNCTION, because the appointment is a path segment rather than a query parameter and
   * the encoding has to happen somewhere. Here, once.
   */
  room: (appointmentId: string) => string
}

/**
 * What went wrong, as a code rather than a sentence.
 *
 * A server action cannot hand a value back to a form that posted natively, so the outcome
 * travels in the query string and the route passes it back in. A CODE rather than the
 * message itself, for two reasons. Each of these needs a different shape of response —
 * `slot_taken` is an ordinary thing that happens and gets a fresh list of times, `refused`
 * is a permissions problem somebody has to solve elsewhere — and a URL is written by
 * whoever sends the link, so a screen that rendered `&message=<anything>` would render a
 * stranger's sentence inside the clinic's own console.
 */
export type BookingProblem = 'slot_taken' | 'refused' | 'incomplete' | 'invalid' | 'failed'
