/**
 * The delivery domain's PUBLIC SURFACE.
 *
 * The dispatch board, creating a delivery for a dispensed order, assigning and reassigning
 * a rider, and the full record with its status thread and its failure reason.
 *
 * Everything else in this folder is internal — the HTTP plumbing in api/http.ts, the lane
 * definitions, the individual forms — and `.dependency-cruiser.cjs` makes reaching past this
 * file a build failure rather than a code-review note.
 *
 * ------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Three screens. A route mounts one inside `<ConsoleShell>` and passes:
 *
 *   <DispatchBoardScreen viewer awaitingDispatch paths />
 *   <DeliveryScreen      deliveryId viewer paths />
 *   <NewDeliveryScreen   orderId orderReference deliverable viewer paths />
 *
 * `viewer` is `currentStaff()`, or `null` for a session that has ended. It decides which
 * controls are OFFERED and nothing else — every policy runs again on the API.
 *
 * `awaitingDispatch` IS FETCHED BY THE ROUTE, FROM THE DISPENSING DOMAIN. Dispensed orders
 * with no delivery yet are that domain's read (`listLane('dispensed')`), and cross-domain
 * composition belongs in `src/app`. Wrap it with `attempt()`, exported below, so a failure
 * renders as a notice inside the board rather than taking the board down.
 *
 * `orderReference` and `deliverable` ON THE NEW-DELIVERY SCREEN COME FROM THE SAME PLACE,
 * and `deliverable` in particular must be the dispensing domain's `mayBeDelivered()`. Do
 * not recompute it here or in a route. The controlled-substance exclusion needs exactly one
 * implementation; two that can disagree is how a controlled medicine ends up on a
 * motorcycle.
 *
 * `paths` is `DispatchPaths`. This domain hard-codes no URL, which is what stops a server
 * action being talked into revalidating or redirecting somewhere a form told it to.
 *
 * ------------------------------------------------------------
 * THREE THINGS WORTH KNOWING BEFORE READING THE SCREENS
 *
 * 1. NOTHING CLINICAL IS ON THIS SURFACE, AND THERE IS NOWHERE TO PUT IT. `DeliveryResource`
 *    and `StoreDeliveryRequest` carry a recipient, a telephone number, an address and a
 *    reference. The rider's own surface is a different resource class again, with an
 *    explicit test covering the absence. The dispense order appears here as a REFERENCE
 *    ONLY.
 *
 * 2. THE BOARD NEVER PAGES BY OFFSET. `GET /v1/deliveries` offers `per_page` and no cursor;
 *    an offset over a table being written to is how a live board loses a row. Six status
 *    lanes, one bounded request each, no next-page control. See model/types.ts.
 *
 * 3. POLLING IS THE FLOOR, NOT A FALLBACK. `LiveBoard` refreshes the server render every
 *    fifteen seconds and nothing here waits on a socket. `@carevelo/realtime` is not yet a
 *    dependency of this app; where it plugs in — `realtime.dispatchBoard()`, and why the
 *    frame would still be only a hint to re-fetch — is written out in components/LiveBoard.tsx.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md §5
 */

/* ---- Screens ---- */
export { DispatchBoardScreen } from './components/DispatchBoardScreen'
export { DeliveryScreen } from './components/DeliveryScreen'
export { NewDeliveryScreen } from './components/NewDeliveryScreen'

/* ---- Reads, for the route layer ---- */
export { currentStaff, getDelivery, listLane, MAX_PER_PAGE, type Lane } from './api/deliveries'

/* ---- The wrapper the route needs to hand this domain a read it made itself ----
   `attempt()` turns a rejected promise into something renderable: the API's own sentence
   where there is one, and `null` where the request never arrived. The board takes
   `awaitingDispatch` in that shape, so the route wraps the dispensing domain's read with
   this rather than inventing a second convention for the same idea. */
export { attempt, type Attempt } from './api/http'

/* ---- Types, all of them from the generated contract ---- */
export type {
  Delivery,
  DeliveryStatus,
  DispatchPaths,
  Viewer,
} from './model/types'
