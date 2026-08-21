/**
 * The scheduling domain's PUBLIC SURFACE.
 *
 * The clinician's day, and the front desk booking on a caller's behalf. Everything else in
 * this folder is internal — the HTTP plumbing in api/gateway.ts, the slot encoding in
 * model/slots.ts, the individual row components — and `.dependency-cruiser.cjs` makes
 * reaching past this file a build failure rather than a code-review note.
 *
 * ------------------------------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Two screens, each a server component that fetches its own data and degrades to a notice
 * rather than throwing. A route mounts one inside `<ConsoleShell active="schedule">` and
 * passes:
 *
 *   <DayView         staff paths day clinician problem message done />
 *   <AssistedBooking staff paths patientId serviceId clinicianId day query problem message />
 *
 * Everything after `paths` is read straight out of `searchParams` and passed through
 * unaltered — the screens own the meaning, the route only carries the values. The route is
 * still responsible for what routes are responsible for: resolving the session, sending a
 * guest to sign in, and sending somebody whose `password_change_required` is set to change
 * it first.
 *
 * `paths` is `SchedulePaths` — where the route layer has mounted these screens. This domain
 * hard-codes no URL, so it can be mounted anywhere and, more importantly, a server action can
 * never be talked into redirecting somewhere a form told it to.
 *
 * ------------------------------------------------------------------------------------
 * WHY THE SESSION IS EXPORTED FROM HERE, WHICH IS TEMPORARY AND SAYS SO
 *
 * `currentStaff()` reads GET /v1/me. It belongs in the identity domain, which is an empty
 * placeholder this change does not own, and it cannot live in `src/lib/` because that is
 * app-global and three concurrent changes would each create it. It is at the foundation of
 * the domain that needs it first, and the consultation and prescribing screens receive the
 * result as a PROP from the route rather than importing across domains.
 *
 * When identity lands: move `currentStaff` and `Staff` there verbatim and delete these two
 * lines. Nothing else moves — only routes call it.
 */

/* ---- Screens ---- */
export { DayView, type DayViewProps } from './components/DayView'
export { AssistedBooking, type AssistedBookingProps } from './components/AssistedBooking'

/* ---- The session, until the identity domain exists. See above. ---- */
export { currentStaff, type Staff } from './api/gateway'

/* ---- Reads, for a route that needs one fact before it renders ----
   Every one of these throws `ApiError` on failure; the screens above catch for themselves. A
   caller outside this domain decides for itself what a failure means on its own surface,
   which is why they are not wrapped here. `getAppointment` is the exception and returns null
   for a 404 or a 403, because a route that cannot find an appointment renders a not-found
   rather than an error and the two statuses are deliberately indistinguishable. */
export { listAppointments, getAppointment, type AppointmentQuery } from './api/appointments'
export { listClinicians, listServices, getPatient } from './api/catalogue'

/* ---- Day arithmetic in the clinic's own zone ----
   Exported because a route composing this domain with another needs to agree with it about
   what day it is, and `new Date().toISOString().slice(0, 10)` disagrees for three hours every
   morning. See model/day.ts. */
export { CLINIC_ZONE, dayOrToday, isIsoDay, readableDay, today, type IsoDay } from './model/day'

/* ---- Types, all of them from the generated contract ---- */
export type {
  Appointment,
  AppointmentStatus,
  AppointmentsPage,
  BookingProblem,
  Clinician,
  ConsultationMode,
  Patient,
  PaymentExpectation,
  SchedulePaths,
  Service,
  Slot,
} from './model/types'
