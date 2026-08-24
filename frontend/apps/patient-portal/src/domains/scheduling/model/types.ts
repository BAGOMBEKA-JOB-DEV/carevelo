import type { components, operations } from '@carevelo/api-client'

/**
 * Every shape this domain handles, taken from the generated contract.
 *
 * NOT ONE OF THESE IS HAND-WRITTEN, and the rule is not stylistic. A hand-written
 * response interface is a second copy of the contract that nothing checks, so it drifts
 * the first time the API adds a field and goes on compiling while the screen renders
 * `undefined`. `packages/api-client/src/generated/schema.d.ts` is generated from
 * docs/40-api/openapi.yaml and committed, so the day a field changes there, every call
 * site in this folder stops compiling — which is the entire point.
 *
 * THE SLOT AND THE PAGE HAVE NO NAMED SCHEMA, so they are reached through `operations`
 * rather than `components`. The availability endpoint describes its response inline and
 * the cursor page is Laravel's own envelope; both are still the contract, and indexing
 * into the operation is how you take them from it instead of retyping them here.
 */

/** A bookable offering, priced by the clinic that offers it. */
export type Service = components['schemas']['ServiceResource']

/**
 * A clinician, as a PATIENT sees them: name, specialty, photo.
 *
 * THE REGISTRATION NUMBER IS NOT ON THIS TYPE AND MUST NEVER BE PUT ON A PATIENT SCREEN.
 * ClinicianResource omits it deliberately — an endpoint every patient of every clinic can
 * reach would otherwise be a harvestable list of practitioner credentials to impersonate.
 * Nothing in this domain displays it, requests it, or asks for an endpoint that has it.
 */
export type Clinician = components['schemas']['ClinicianResource']

export type Appointment = components['schemas']['AppointmentResource']

/**
 * in_person | video | voice | chat.
 *
 * VOICE AND CHAT ARE FIRST-CLASS BOOKABLE MODES, not degraded fallbacks. A patient on a
 * poor connection — which in this market is a large share of them at any moment — must be
 * able to CHOOSE voice deliberately rather than fight a failing video call. Everything in
 * this domain that renders a mode renders the four as equals: same control, same weight,
 * same amount of explanation.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md §1
 */
export type ConsultationMode = components['schemas']['ConsultationMode']

export type AppointmentStatus = components['schemas']['AppointmentStatus']

/** The booking body, exactly as POST /v1/appointments accepts it. */
export type BookingBody = components['schemas']['StoreAppointmentRequest']

/** `prepaid` or `pay_at_clinic`. There is no third option. */
export type PaymentExpectation = BookingBody['payment_expectation']

type AvailabilityResponse =
  operations['v1.availability.index']['responses'][200]['content']['application/json']

/**
 * One offered slot.
 *
 * ADVISORY, ALWAYS. AvailabilityController computes these from the clinic's working hours
 * minus busy periods and says so in as many words: booking re-checks the slot inside a
 * transaction, because two patients can read the same free slot a millisecond apart. A UI
 * that treats a slot as a reservation is a UI that shows a patient an error page for
 * something that is not their fault and is not a fault at all.
 */
export type Slot = AvailabilityResponse['data'][number]

/** What the availability answer says about itself — the window it actually covered. */
export type AvailabilityMeta = AvailabilityResponse['meta']

type AppointmentPage =
  operations['v1.appointments.index']['responses'][200]['content']['application/json']

/**
 * A page of appointments.
 *
 * CURSOR, NOT OFFSET. An offset page duplicates and skips rows while the clinic is
 * booking beside you, and a skipped row here is an appointment a patient never sees.
 */
export type AppointmentsPage = AppointmentPage

/**
 * Where the route layer has mounted the screens this domain exports.
 *
 * PASSED IN RATHER THAN GUESSED. This domain owns no routes and must not assume the URLs
 * it lives at — a hard-coded `/book` here is a domain that cannot be mounted twice or
 * moved once. Every link and every post-submit redirect is built from this.
 */
export type SchedulingPaths = {
  /** Where `<ServiceCatalogue>` is mounted. */
  browse: string
  /** Where `<BookingScreen>` is mounted. Receives `?service=&clinician=&day=&problem=&message=`. */
  book: string
  /** Where `<AppointmentsScreen>` is mounted. Receives `?past=&cursor=&booked=&problem=&message=`. */
  appointments: string
  /**
   * Where the PAYMENTS domain collects for an appointment. Receives `?appointment=<id>`.
   *
   * Optional, and its absence is meaningful rather than untidy: this domain offers
   * "pay now" only when there is somewhere for that to lead. A booking made prepaid with
   * nowhere to pay is an appointment that holds a slot for fifteen minutes and then
   * expires, which is worse for the patient than never being offered the choice.
   */
  payment?: string | undefined
}

/**
 * What went wrong, as a code rather than a sentence.
 *
 * A server action cannot hand a value back to a form that posted natively, so the outcome
 * travels in the query string and the route layer passes it back in. A CODE rather than
 * the message itself, because each of these needs a different shape of response —
 * `slot_taken` is a normal thing that happens and gets a warning and a fresh list, while
 * `failed` is an apology — and because a sentence chosen here could not be translated.
 */
export type BookingProblem = 'slot_taken' | 'refused' | 'incomplete' | 'invalid' | 'failed'
