import type { components } from '@carevelo/api-client'

/**
 * Every type this domain uses, taken from the generated contract.
 *
 * Nothing here is hand-written. A hand-written request or response type is a second copy
 * of the contract that drifts in silence, and `docs/30-architecture/frontend-nextjs.md`
 * forbids one. What this file does is give the generated shapes names short enough to read
 * in a component signature.
 */

type Schemas = components['schemas']

/**
 * The dispatcher's view of a delivery.
 *
 * NOTE WHAT IS ON IT AND WHAT IS NOT. Recipient, telephone, address, district, landmark,
 * a package reference and a status. No medicine, no item list, no diagnosis, no note —
 * there is no field on this resource that could carry one.
 *
 * That is not this client's achievement. `DeliveryResource` and `RiderDeliveryResource` are
 * deliberately separate classes on the API, and the controller comment says why: "Do not
 * merge them: a shared controller is one forgotten conditional away from serving a
 * dispatcher payload to a rider." Acceptance criterion 6 covers it with an explicit test.
 * The reason to know it here is the opposite one — nothing on this screen should ever
 * reach for a medicine name to "help" the dispatcher, because the moment a screen wants
 * one, somebody puts it on the resource.
 */
export type Delivery = Schemas['DeliveryResource']

/**
 * The seven states a delivery moves through.
 *
 * `DeliveryResource.status` is typed `string` rather than this union, because the resource
 * emits `$this->status->value` and the generator cannot see the enum through it. So the
 * union is used where we CHOOSE a status (a lane, a filter) and a read narrows a string
 * against it — which is what makes the lane map in ./status.ts a compile error when the
 * contract gains a state.
 */
export type DeliveryStatus = Schemas['DeliveryStatus']

/** What creating a delivery accepts. A name, a number, an address. Nothing clinical. */
export type StoreDeliveryRequest = Schemas['StoreDeliveryRequest']

/** The patient's tracking view: milestones and a failure reason, never contents. */
export type Tracking = {
  id: string
  reference: string
  status: string
  failure_reason: string | null
  assigned_at: string | null
  delivered_at: string | null
  milestones: string[]
}

/** A member of this clinic's staff, for the rider picker. */
export type Staff = Schemas['StaffResource']

/**
 * Who is looking at the screen.
 *
 * Roles, never permissions — `MeResource` carries role names and
 * `docs/50-security-compliance/rbac-matrix.md` is written in roles. A client that reasoned
 * about individual permissions would drift from the matrix, and the matrix is the contract.
 *
 * NOTHING DERIVED FROM THIS IS THE SECURITY BOUNDARY. Every policy runs again on the API,
 * and a control hidden here is still refused if a request for it is built by hand. What it
 * decides is whether a control is OFFERED — a dispatcher shown an assign button they can
 * never use learns to distrust the screen.
 */
export type Viewer = Schemas['MeResource']

/**
 * A page of the dispatch board.
 *
 * ------------------------------------------------------------
 * THE SAME PAGINATION GAP AS THE PHARMACY QUEUE, AND THE SAME ANSWER.
 *
 * The house rule is cursor pagination, never offset, and a dispatch board is exactly the
 * traffic the rule is about: deliveries are created and reassigned while a dispatcher reads
 * the screen, and an offset under that duplicates and skips rows. A skipped row here is a
 * package nobody dispatches.
 *
 * `GET /v1/deliveries` pages by `per_page` and Laravel's implicit `page` — see
 * `DispatchBoardRequest`, whose rules name `status`, `rider_id` and `per_page` and no
 * cursor, and whose controller calls `->paginate()`. `GET /v1/tenant/users` in the same API
 * does use a cursor, so this is a gap in one endpoint rather than a house style.
 *
 * SO THIS DOMAIN NEVER SENDS `page`. Each lane is one bounded request at the maximum page
 * size, oldest first, and there is no next-page control on the board. A lane that overflows
 * says so in words. Worse than paging, and the only version that cannot lose a delivery.
 */
export type DeliveryPage = {
  data: Delivery[]
  meta: { current_page: number; last_page: number; per_page: number; total: number }
}

/**
 * Where the route layer has mounted this domain's screens.
 *
 * This domain hard-codes no URL. A server action that redirects needs somewhere to send
 * the browser, and a path read out of a form field is a redirect an attacker writes.
 * Closing over these means the destination is decided by the route and cannot be supplied
 * by a request.
 */
export type DispatchPaths = {
  /** The board. */
  board: string
  /** One delivery's full record, given its id. */
  delivery: (id: string) => string
  /**
   * The same route as `delivery`, written as a template with a literal `{id}`.
   *
   * BOTH EXIST BECAUSE A BOUND SERVER-ACTION ARGUMENT MUST BE SERIALISABLE. A function
   * passed as a bound argument compiles and then fails at runtime, which is the worst
   * combination available. `delivery()` is for rendering an href during a server render;
   * this string is what `createDelivery` is bound with so it knows where to send the
   * browser afterwards. See api/actions.ts.
   */
  deliveryTemplate: string
  /** The create-a-delivery screen, for a given dispense order. */
  newDelivery: (orderId: string) => string
  /**
   * Back to the dispense order this delivery came from. Owned by the dispensing domain and
   * mounted by the route layer, so this domain links to it without importing it.
   */
  order: (orderId: string) => string
}

export type DispatchAbilities = {
  /** May see the board and create a delivery. Administrator, dispatcher or pharmacist. */
  seesTheBoard: boolean
  /** May assign or reassign a rider. Administrator or dispatcher — never a rider. */
  assignsRiders: boolean
  /** May list the clinic's staff, which is how the rider picker gets names. Admin only. */
  listsStaff: boolean
}
