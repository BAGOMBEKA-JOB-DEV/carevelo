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
 * ON THIS SURFACE THERE IS A SECOND REASON, AND IT IS THE MORE IMPORTANT ONE.
 * `RiderDeliveryResource` is a SEPARATE resource class with no clinical fields, rather
 * than the dispatcher's `DeliveryResource` with fields hidden — "a hidden field is one
 * careless template away from being displayed; an absent field cannot be". Deriving the
 * type from that class rather than describing a delivery by hand is what carries the same
 * guarantee into the frontend: there is no `medicines`, no `diagnosis`, no `notes` and no
 * `dispense_order` to render here, because there is no such property on the type. A hand-
 * written interface would have been free to grow one, and the first `?? null` beside it
 * would have made the omission look like an oversight instead of the rule it is.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md — "The rider rule"
 * @see backend/app/Http/Resources/V1/RiderDeliveryResource.php
 */

/**
 * A delivery, as a RIDER sees it: recipient name, recipient phone, address, package
 * reference, status. That is the whole of it, and it is everything needed to hand a
 * package to the right person.
 */
export type RiderDelivery = components['schemas']['RiderDeliveryResource']

/**
 * Every state a delivery can be in, across the whole system.
 *
 * The RIDER only ever sees four of them and can only reach three — see model/status.ts,
 * where that narrowing is written down as a table the compiler checks rather than as a
 * set of `if`s spread across the screens.
 *
 * @see backend/app/Models/DeliveryStatus.php — the transitions, which are enforced there
 */
export type DeliveryStatus = components['schemas']['DeliveryStatus']

/**
 * A page of the rider's own assignments.
 *
 * REACHED THROUGH `operations` BECAUSE LARAVEL'S CURSOR ENVELOPE HAS NO NAMED SCHEMA. It
 * is still the contract; indexing into the operation is how you take it from there
 * instead of retyping it.
 *
 * CURSOR, NOT OFFSET. The dispatcher is assigning and reassigning work into the same
 * table while a rider pages through it, which is exactly the traffic under which an
 * offset page duplicates and skips rows — and a skipped row here is a package that never
 * gets collected.
 */
export type AssignmentsPage =
  operations['v1.rider.deliveries.index']['responses'][200]['content']['application/json']

/**
 * The status body, exactly as `POST /v1/rider/deliveries/{id}/status` accepts it.
 *
 * ONE ENDPOINT CARRYING THE TARGET STATUS, NOT FOUR VERBS. There is no `/pick-up`,
 * `/depart`, `/deliver` and `/fail`; there is one call that says where the delivery is
 * going and one state machine on the server that decides whether it may. Four endpoints
 * would be four places for the transition rules to be re-implemented and to disagree.
 */
export type StatusBody =
  operations['v1.rider.deliveries.status']['requestBody']['content']['application/json']

/**
 * Where the route layer has mounted the screens this domain exports.
 *
 * PASSED IN RATHER THAN GUESSED. This domain owns no routes and must not assume the URLs
 * it lives at — a hard-coded `/assignments` here is a domain that cannot be mounted twice
 * or moved once. Every link and every post-submit redirect is built from this, which also
 * means a Server Action's destination always comes from the server and never from
 * something the form told it.
 */
export type DeliveryPaths = {
  /** Where `<AssignmentsScreen>` is mounted. */
  assignments: string
  /**
   * Where `<CompletedScreen>` is mounted.
   *
   * A SEPARATE ENTRY RATHER THAN `assignments` WITH A QUERY STRING, because the two are
   * two ROUTES: the app's tab bar links to both by path, `FieldShell` marks one of them
   * current, and a screen that paged itself by appending `?cursor=` to the other tab's URL
   * would send a rider to the round every time they asked for more history.
   */
  completed: string
  /**
   * Where `<DeliveryScreen>` is mounted, with `{delivery}` standing in for the id.
   * e.g. `/assignments/{delivery}`.
   */
  delivery: string
}

/**
 * What went wrong, as a code rather than a sentence.
 *
 * A Server Action cannot hand a value back to a form that posted natively, so the outcome
 * travels in the query string and the route passes it back in. A CODE rather than the
 * message, because each of these needs a different shape of response — `already` is not a
 * failure at all and gets a confirmation, `refused` means the delivery is no longer this
 * rider's and gets sent back to the list — and because the screen, not the action, owns
 * the words.
 */
export type StatusProblem =
  /** The state machine refused the move: something else changed the delivery first. */
  | 'conflict'
  /** No longer assigned to this rider, or never was. Cross-tenant reads land here too. */
  | 'refused'
  /** A failure reason that is not on the fixed list, or a missing one. */
  | 'invalid'
  /** The request did not complete. Nothing is known about whether it landed. */
  | 'failed'
