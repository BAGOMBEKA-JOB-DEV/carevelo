/**
 * The audit domain's PUBLIC SURFACE.
 *
 * The evidence layer, read back: Carevelo's own trail in full, and a clinic's as metadata
 * only. Everything else in this folder is internal, and `.dependency-cruiser.cjs` makes
 * reaching past this file a build failure rather than a code-review note.
 *
 * ------------------------------------------------------------
 * WHY IT IS ITS OWN DOMAIN AND NOT PART OF `platform`
 *
 * Because it reads a different thing under a different rule. The platform domain
 * administers clinics — provision, suspend, export — and every one of its screens is about
 * a clinic's ADMINISTRATION. This one reads a log that spans Carevelo's own actions and, on
 * request, a clinic's, under a projection that exists precisely to keep the two apart.
 * Folding it into the register would put "read this clinic's trail" beside "suspend this
 * clinic", as though they were the same kind of act.
 *
 * ------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 *   <AuditRegisterScreen paths clinics clinicsComplete
 *                        tenantId action actorId from to cursor />
 *
 * `clinics` and `clinicsComplete` come from the platform domain's `listAllTenants()`, so
 * the two domains are composed in the route rather than reaching into each other. `clinics`
 * is `null` when that read FAILED, and the screen degrades to a plain identifier field
 * rather than hiding the picker.
 *
 * The rest are the query parameters, passed through unchanged. This domain never reads the
 * URL for itself: a screen that reached for `searchParams` could not be mounted twice and
 * could not be tested without a request.
 *
 * ------------------------------------------------------------
 * THERE IS NO EXPORT, NO CORRECTION AND NO DELETE, AND THAT IS THE CONTRACT
 *
 * `GET` is the only method on `/v1/platform/audit-events`. Audit events are written by the
 * API as a side effect of domain operations and the application role is denied UPDATE and
 * DELETE by database grant, so nothing this app could offer would change one. A download
 * would be a new endpoint rather than a button — compliance exports run from the retention
 * process, under separate credentials.
 *
 * @see docs/50-security-compliance/audit-logging.md
 */

/* ---- The screen ---- */
export { AuditRegisterScreen, type AuditRegisterScreenProps } from './components/AuditRegisterScreen'

/* ---- The read, for a route that needs a count or a link. Throws `ApiError`; the screen
   catches for itself through `attempt()`. ---- */
export { listAuditEvents } from './api/events'

/* ---- Types, all of them from the generated contract ---- */
export type { AuditEvent, AuditEventsPage, AuditPaths, AuditProjection, AuditQuery } from './model/types'
