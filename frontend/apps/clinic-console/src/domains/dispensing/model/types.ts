import type { components } from '@carevelo/api-client'

/**
 * Every type this domain uses, taken from the generated contract.
 *
 * NOTHING HERE IS HAND-WRITTEN, and that is a rule rather than a preference:
 * `docs/30-architecture/frontend-nextjs.md` forbids a hand-written request or response
 * type because it is a second copy of the contract that drifts in silence. What this file
 * does is give the generated shapes names short enough to read in a component signature,
 * and nothing else. If a field disappears from the OpenAPI document, every screen below
 * stops compiling — which is the entire point.
 *
 * @see packages/api-client/src/generated/schema.d.ts — generated, committed, never edited
 */

type Schemas = components['schemas']

export type DispenseOrder = Schemas['DispenseOrderResource']
export type DispenseItem = Schemas['DispenseItemResource']
export type Substitution = Schemas['SubstitutionResource']
export type Prescription = Schemas['PrescriptionResource']
export type PrescriptionItem = Schemas['PrescriptionItemResource']

/**
 * The sixteen states an order can be in.
 *
 * Note that `DispenseOrderResource.status` is typed `string`, not this enum — the resource
 * emits `$this->status->value` and the generator cannot see through that. So the enum is
 * imported for the places we CHOOSE a status (a query filter, a lane definition) and the
 * places we READ one narrow a string against it. The compiler cannot do that for us; what
 * it can do is fail if a case disappears from the contract, which is why the lane map in
 * ./status.ts is a `Record` over this union.
 */
export type DispenseOrderStatus = Schemas['DispenseOrderStatus']

/** What the pricing endpoint accepts. One line per prescribed item, always. */
export type PriceRequest = Schemas['PriceDispenseOrderRequest']
export type PriceRequestItem = PriceRequest['items'][number]

/** Pickup or delivery. Two values and no default — see RecordFulfilmentRequest. */
export type FulfilmentMethod = Schemas['RecordFulfilmentRequest']['method']

/**
 * A page of the pharmacy queue.
 *
 * ------------------------------------------------------------
 * THE PAGINATION THIS ENDPOINT OFFERS IS NOT THE PAGINATION A LIVE QUEUE WANTS, and that
 * is worth stating plainly at the type rather than discovering in a component.
 *
 * The house rule is cursor pagination, never offset, and the reason is exactly this
 * screen: orders arrive into the same table while a pharmacist reads it, and an offset
 * under that traffic duplicates and skips rows. A skipped row here is a patient standing
 * at the counter whose order the pharmacy never saw.
 *
 * `GET /v1/dispense-orders` pages by `page`/`per_page` — see
 * `IndexDispenseOrderRequest`, whose rules name both and whose controller calls
 * `->paginate()` rather than `->cursorPaginate()`. `GET /v1/tenant/users` in the same API
 * does use a cursor, so this is a gap in one endpoint rather than a house style. Until it
 * closes, the contract simply cannot express the safe query, and no amount of client code
 * invents one: sending `?cursor=` would be silently ignored by `RejectsUnknownFields`'s
 * sibling validation and page two would still be an offset.
 *
 * SO THIS DOMAIN NEVER HOLDS AN OFFSET. See ./status.ts and api/queue.ts: each lane is one
 * bounded request at the maximum page size, oldest first, and there is no "next page"
 * control anywhere on the queue. A lane that overflows says so in words and asks the
 * pharmacist to narrow by status. That is a worse experience than paging and the only one
 * that cannot lose an order.
 */
export type DispenseOrderPage = {
  data: DispenseOrder[]
  meta: { current_page: number; last_page: number; per_page: number; total: number }
}

/**
 * Where the route layer has mounted this domain's screens.
 *
 * This domain hard-codes no URL. That is not tidiness: a server action that redirects
 * needs somewhere to send the browser, and a path read out of a form field is a redirect
 * an attacker writes. Closing over these values means the destination is decided by the
 * route at build time and cannot be supplied by a request.
 */
export type DispensingPaths = {
  /** The queue. */
  queue: string
  /** A single order, given its id. */
  order: (id: string) => string
  /**
   * Where "create a delivery for this order" goes. Owned by the delivery domain and
   * mounted by the route layer, so this domain links to it without importing it.
   */
  newDelivery: (orderId: string) => string
}

/**
 * Who is looking at the screen.
 *
 * Roles, never permissions — `StaffResource` and `MeResource` both carry role names, and
 * `docs/50-security-compliance/rbac-matrix.md` is written in roles. A client that reasoned
 * about individual permissions would drift from the matrix, and the matrix is the
 * contract.
 *
 * NOTHING HERE IS THE SECURITY BOUNDARY. Every policy runs again on the API, and a control
 * this object hides is still refused if a request for it is built by hand. What these
 * flags decide is whether a control is OFFERED — a pharmacist shown an approve button they
 * can never use learns to distrust the screen.
 */
export type Viewer = components['schemas']['MeResource']

export type ViewerAbilities = {
  /** May open, price and reject at the bench. Administrator or pharmacist. */
  worksTheBench: boolean
  /** May dispense and record a collection. Pharmacist ONLY — never an administrator. */
  dispenses: boolean
  /** May propose a substitute. Pharmacist only. */
  proposesSubstitutions: boolean
  /** May approve or reject one. Clinician ONLY — not the proposer, not the administrator. */
  decidesSubstitutions: boolean
}
