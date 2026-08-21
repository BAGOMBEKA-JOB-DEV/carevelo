/**
 * The scheduling domain's PUBLIC SURFACE.
 *
 * Browse the clinic's services, choose a clinician / a mode / a time, book, and see what
 * you have booked. Everything else in this folder is internal — the HTTP plumbing in
 * api/http.ts, the slot encoding in model/slots.ts, the individual row components — and
 * `.dependency-cruiser.cjs` makes reaching past this file a build failure rather than a
 * code-review note.
 *
 * ------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Three screens, each a server component that fetches its own data and degrades to a
 * notice rather than throwing. A route mounts one inside `<SiteShell>` and passes:
 *
 *   <ServiceCatalogue tenant paths />
 *   <BookingScreen    tenant paths patientId
 *                     serviceId clinicianId day
 *                     onlinePaymentAvailable problem message />
 *   <AppointmentsScreen tenant paths past cursor booked cancelled problem message />
 *
 * `tenant` is `resolveTenant()`. Everything after `paths` on the last two is read
 * straight out of `searchParams` and passed through — the screens own the meaning, the
 * route only carries the values. The route is still responsible for what routes are
 * responsible for: redirecting a guest to sign-in, and redirecting a patient whose
 * `password_change_required` is set, exactly as `app/account/page.tsx` already does.
 *
 * `paths` is `SchedulingPaths` — where the route layer has mounted these screens. This
 * domain hard-codes no URL, so it can be mounted anywhere and, more importantly, a server
 * action can never be talked into redirecting somewhere a form told it to.
 *
 * `patientId` IS THE ONE THING THIS DOMAIN CANNOT FETCH FOR ITSELF. A patient's session
 * identifies a USER; `MeResource` carries no `patient_id`, and `GET /v1/patients` is
 * staff-only. The route layer must obtain it — today, from the patients domain — and pass
 * it in. It is closed over by the booking action rather than posted in a hidden field, so
 * it cannot be edited in a form.
 *
 * `onlinePaymentAvailable` IS ALSO NOT KNOWABLE FROM HERE. §H1.6 says a clinic with no
 * payment aggregator can only offer pay-at-clinic, and the flag that says so
 * (`AggregatorAccountResource.accepts_online_payment`) is on an administrator-only
 * endpoint. It defaults to `false`, which is the safe direction: the worst case is a
 * patient who pays at the desk rather than one who books a slot they cannot pay for and
 * watches it expire in fifteen minutes.
 */

/* ---- Screens ---- */
export { ServiceCatalogue } from './components/ServiceCatalogue'
export { BookingScreen, type BookingScreenProps } from './components/BookingScreen'
export {
  AppointmentsScreen,
  type AppointmentsScreenProps,
} from './components/AppointmentsScreen'

/* ---- Reads, for other domains and for a route that needs a count or a title ----
   Every one of these throws `ApiError` on failure; the screens above catch for
   themselves. A caller outside this domain is expected to decide what a failure means on
   its own surface, which is why they are not wrapped here. */
export { listServices, listClinicians, byId } from './api/catalogue'
export { listAvailability, type Availability, type AvailabilityQuery } from './api/availability'
export {
  listAppointments,
  getAppointment,
  type AppointmentQuery,
} from './api/appointments'

/* ---- The one number the payments domain needs from this one ----
   A prepaid booking holds its slot for exactly this long from `created_at`, after which
   `appointments:release-unpaid` gives it back. A payment screen that tells the patient a
   different number would be telling them a different truth. */
export { UNPAID_HOLD_MINUTES, holdExpiresAt } from './model/hold'

/* ---- Types, all of them from the generated contract ---- */
export type {
  Appointment,
  AppointmentStatus,
  AppointmentsPage,
  BookingProblem,
  Clinician,
  ConsultationMode,
  PaymentExpectation,
  SchedulingPaths,
  Service,
  Slot,
} from './model/types'
