/**
 * The dispensing domain's PUBLIC SURFACE.
 *
 * The clinic's own NDA-licensed pharmacy, working: the live queue, the order at the bench,
 * pricing at the clinic's own prices, substitution proposals and decisions, partial fills,
 * dispensing against a named pharmacist, ready-for-pickup and collection, and declining an
 * order with a reason.
 *
 * Everything else in this folder is internal — the HTTP plumbing in api/http.ts, the
 * shilling arithmetic in model/money.ts, the individual forms — and `.dependency-cruiser.cjs`
 * makes reaching past this file a build failure rather than a code-review note.
 *
 * ------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Two screens, each a server component that fetches its own data and degrades to a notice
 * rather than throwing. A route mounts one inside `<ConsoleShell>` and passes:
 *
 *   <PharmacyQueueScreen viewer paths />
 *   <OrderScreen orderId viewer paths />
 *
 * `viewer` is `currentStaff()`, or `null` for a session that has ended. It decides which
 * controls are OFFERED and nothing else — every policy runs again on the API, and a control
 * hidden here is still refused if a request for it is built by hand.
 *
 * `paths` is `DispensingPaths` — where the route layer has mounted these screens, plus
 * where the DELIVERY domain's "create a delivery" screen lives. This domain hard-codes no
 * URL, so it can be mounted anywhere and, more importantly, a server action can never be
 * talked into revalidating or linking somewhere a form told it to.
 *
 * ------------------------------------------------------------
 * THREE THINGS WORTH KNOWING BEFORE READING THE SCREENS
 *
 * 1. THE PRESCRIPTION IS NEVER EDITED. There is no call to a prescription endpoint
 *    anywhere in this folder. Everything the pharmacy does happens on the dispense order,
 *    because what was prescribed and what was dispensed are different facts and both have
 *    to survive.
 *
 * 2. THE QUEUE NEVER PAGES BY OFFSET. `GET /v1/dispense-orders` offers `page`/`per_page`
 *    and no cursor, and an offset over a table being written to is how a live queue loses
 *    a row. So the queue is five status lanes, one bounded request each, and there is no
 *    next-page control on it at all. See api/queue.ts.
 *
 * 3. POLLING IS THE FLOOR, NOT A FALLBACK. `LiveQueue` refreshes the server render every
 *    fifteen seconds and nothing on this screen waits on a socket. `@carevelo/realtime` is
 *    not yet a dependency of this app; where it plugs in, and why the frame would still
 *    only be a hint to re-fetch, is written out in components/LiveQueue.tsx.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 */

/* ---- Screens ---- */
export { PharmacyQueueScreen } from './components/PharmacyQueueScreen'
export { OrderScreen } from './components/OrderScreen'

/* ---- Reads, for the route layer and for the dispatch board ----
   `listLane` and `getOrder` throw `ApiError`; the screens above catch for themselves. A
   caller outside this domain decides for itself what a failure means on its own surface,
   which is why they are not wrapped here. */
export { listLane, getOrder, currentStaff, MAX_PER_PAGE, type Lane } from './api/queue'

/* ---- The facts other surfaces need about an order ----
   The dispatch board shows a dispense order as a REFERENCE ONLY, and it needs exactly one
   judgement from this domain: whether the order may be delivered at all. Exported so the
   controlled-substance rule has one implementation rather than two that can disagree. */
export { mayBeDelivered, controlledItems } from './model/order'

/* ---- Types, all of them from the generated contract ---- */
export type {
  DispenseOrder,
  DispenseOrderStatus,
  DispensingPaths,
  Viewer,
} from './model/types'
