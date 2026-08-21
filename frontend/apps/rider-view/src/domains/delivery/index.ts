/**
 * The delivery domain's PUBLIC SURFACE.
 *
 * The rider's round and the one control that moves a delivery along it. Everything else
 * in this folder is internal — the HTTP calls in api/, the state table in model/status.ts,
 * the individual cards — and `.dependency-cruiser.cjs` makes reaching past this file a
 * build failure rather than a code-review note.
 *
 * ==================================================================
 * THE RULE THIS DOMAIN EXISTS UNDER
 * ==================================================================
 *
 * > A delivery rider receives: recipient name, recipient phone, delivery address, and a
 * > package reference.
 * > A delivery rider never receives: a diagnosis, a clinical note, a prescription, or a
 * > medicine list.
 *
 * The backend enforces that with `RiderDeliveryResource` — a SEPARATE resource class with
 * no clinical fields, rather than the dispatcher's with fields hidden, "because a hidden
 * field is one careless template away from being displayed; an absent field cannot be".
 *
 * This app is the frontend half of the same argument, and the argument only holds while
 * three things stay true:
 *
 *  1. THIS APP IMPORTS NO PRESCRIPTIONS, CONSULTATIONS, DISPENSING OR PATIENTS DOMAIN.
 *     Those directories do not exist here and must not be created. A clinical component
 *     that cannot be in the bundle cannot be rendered by mistake.
 *  2. EVERY TYPE IN model/types.ts COMES FROM THE GENERATED CONTRACT. There is no
 *     hand-written delivery interface that could quietly grow a `medicines` field.
 *  3. THE ONLY ENDPOINTS TOUCHED ARE THE THREE UNDER `/v1/rider`. `/v1/deliveries`,
 *     `/v1/dispense-orders` and `/v1/prescriptions` exist and are staff endpoints; a
 *     rider's session would be refused by them, but the refusal is not the control. The
 *     control is that nothing here has a reason to know their names.
 *
 * Anything that arrives as a request to show a rider "just what is in the package" is a
 * request to change the server first, and the argument belongs there.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md — "The rider rule"
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 *
 * ==================================================================
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 * ==================================================================
 *
 * Two screens, both mounted inside `<FieldShell>`, both behind the identity domain's
 * guard — `currentRider()` for a session and `isRider()` for the role, because the API
 * answers a non-rider with an empty list, which on this screen is indistinguishable from
 * a quiet morning.
 *
 *   <AssignmentsScreen paths cursor done problem message />
 *   <DeliveryScreen    delivery paths reporting done already problem message />
 *
 * `paths` is `DeliveryPaths`: where the route layer has mounted these two, with
 * `{delivery}` standing in for the id in the second. This domain hard-codes no URL, so it
 * can be mounted anywhere and — more to the point — a Server Action can never be talked
 * into redirecting somewhere a form told it to.
 *
 * Everything after `paths` is read straight out of `searchParams` and passed through: the
 * screens own the meaning, the route only carries the values.
 *
 * `delivery` IS FETCHED BY THE ROUTE, not by the screen, and that is the one asymmetry
 * between the two. `getAssignment()` returns null for 404 AND 403 alike so that one
 * `notFound()` covers both and nothing leaks about which clinic holds which record — and
 * `notFound()` belongs to the route, as does the `generateMetadata` that needs the same
 * record.
 *
 * NEITHER SCREEN MAY BE STATIC. Both read cookies through the API client, so they are
 * dynamic already; do not add caching to either. A rider is watching the list for a
 * change.
 */

/* ---- Screens ---- */
export { AssignmentsScreen, type AssignmentsScreenProps } from './components/AssignmentsScreen'
export { DeliveryScreen, type DeliveryScreenProps } from './components/DeliveryScreen'

/* ---- Reads, for a route that must 404 or set a title.
   `getAssignment` is null-on-refusal and never throws for a missing record;
   `listAssignments` throws `ApiError`, and the screen above catches for itself. ---- */
export { getAssignment, listAssignments } from './api/deliveries'

/* ---- Types, all of them from the generated contract ---- */
export type {
  AssignmentsPage,
  DeliveryPaths,
  DeliveryStatus,
  RiderDelivery,
  StatusProblem,
} from './model/types'

/*
 * DELIBERATELY NOT EXPORTED: `setStatus`, and the status table it is driven by.
 *
 * A status change is reachable only through `DeliveryScreen`'s own Server Actions, which
 * close over the target the SERVER chose from the delivery's current state. An exported
 * mutation is an invitation to call it with a target that came from somewhere else — a
 * form field, a query parameter — and a rider is then one crafted request away from
 * recording a delivery they never made. The state machine on the server would refuse most
 * of those; it would not refuse `en_route → delivered`, which is the one that matters.
 */
