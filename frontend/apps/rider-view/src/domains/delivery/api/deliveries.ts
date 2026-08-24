import { unstable_rethrow } from 'next/navigation'
import { ApiError } from '@carevelo/api-client'
import { readClient, writeClient } from '@/domains/identity'
import { hasReached, isFailureReason } from '../model/status'
import type {
  AssignmentsPage,
  DeliveryStatus,
  RiderDelivery,
  StatusBody,
  StatusProblem,
} from '../model/types'

/**
 * The three ENDPOINTS this app touches. There are only three, and there will not be a
 * fourth.
 *
 *   GET  /v1/rider/deliveries              — this rider's own assignments, active or
 *                                            recently finished, chosen by `?status=`
 *   GET  /v1/rider/deliveries/{id}         — one of them
 *   POST /v1/rider/deliveries/{id}/status  — move it
 *
 * Four functions, three endpoints: the listing answers two questions and the difference
 * between them is one published parameter, not a second route. See `listCompleted()`.
 *
 * ------------------------------------------------------------
 * WHAT THE RIDER IS SHOWN IS NOT DECIDED HERE, AND CANNOT BE
 *
 * `RiderDeliveryController::index()` filters on `rider_id` from the SESSION, and
 * `DeliveryPolicy::updateStatus()` admits only the assigned rider of the same tenant. So
 * there is no query this file could write that would return another rider's work, and no
 * ownership filter is passed below — passing one would do nothing and would suggest,
 * wrongly, that it is what protects the data.
 *
 * ------------------------------------------------------------
 * THERE IS NO CALL HERE THAT COULD RETURN A CLINICAL FIELD
 *
 * Not because the calls avoid asking for one, but because the endpoints do not have one
 * to give: the rider namespace serves `RiderDeliveryResource`, a separate class with no
 * clinical fields on it at all. Nothing in this file may reach for `/v1/deliveries`,
 * `/v1/dispense-orders`, `/v1/prescriptions` or `/v1/patients` — those exist, they are
 * staff endpoints, and a rider's session would be refused by them. The refusal is not the
 * control; the control is that this app has no reason to know their names.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md — "The rider rule"
 */

/**
 * This rider's active assignments, oldest first.
 *
 * "ACTIVE" IS THE SERVER'S DEFINITION AND THERE IS NO WAY TO WIDEN IT. `index()` maps the
 * word onto `assigned`, `picked_up` and `en_route` and orders by `assigned_at`, and
 * `RiderAssignmentsRequest` publishes exactly two values for `?status=` — the two tabs this
 * app has — rather than the seven-case `DeliveryStatus` enum the dispatch board speaks.
 * That narrowness is the point: the wider parameter would let the least-trusted actor in
 * the system compose questions no screen here answers, "which of my deliveries are
 * unassigned" among them, which is a question about work being taken away from somebody.
 *
 * NO PARAMETER IS SENT FOR THE DEFAULT, AND THAT IS DELIBERATE. `active` is the server's
 * default and the default is the OLD behaviour, so this call is byte-for-byte the request
 * it was before the parameter existed. Sending `status=active` explicitly would look like
 * belt and braces and would in fact be a second place for the default to be decided.
 *
 * `cursor` AND `status` ARE BOTH SENT THOUGH THE CONTRACT DESCRIBES NEITHER.
 * `operations['v1.rider.deliveries.index']` still types `query` as `never`, because
 * `docs/40-api/openapi.yaml` has not been regenerated for this endpoint —
 * `RiderAssignmentsRequest` validates both, and `meta.next_cursor` is published in the
 * response. A paginator that hands out a cursor and an operation that documents no way to
 * send one back is a gap in the specification, not a reason to page by offset: offset is
 * what duplicates and skips rows while the dispatcher assigns beside you, and a skipped row
 * here is a package nobody collects. `RequestOptions.query` is a plain record, so this
 * compiles; the day the operation gains a query schema, both calls stop needing a comment.
 */
export async function listAssignments(cursor?: string | undefined): Promise<AssignmentsPage> {
  const client = await readClient()

  return client.get<AssignmentsPage>('/v1/rider/deliveries', { query: { cursor } })
}

/**
 * What this rider has finished recently, newest first.
 *
 * ==================================================================
 * THIS CALL READS BACK A BOUNDED WINDOW, AND THE BOUND IS THE SERVER'S
 * ==================================================================
 *
 * `RiderDeliveryController::COMPLETED_WINDOW_HOURS` is 72, and its docblock argues the
 * number at length: every row here carries a named person's telephone number and the
 * street address where their medicines were taken, and the fact that a named person
 * received a delivery from a named clinic is itself health data under DPPA 2019 whether or
 * not a medicine is named. An all-time history would turn a rider's handset — a personal
 * phone that leaves the clinic every evening and may be sold, lost or handed on — into a
 * standing, exportable list of a clinic's patients and where they live.
 *
 * NOTHING IN THIS FILE MAY WIDEN THAT, AND NOTHING HERE TRIES. There is no `from`, no
 * `until` and no `per_page` above the endpoint's own ceiling, because the parameter set the
 * server publishes is two words and a cursor. The bound is enforced on `show` as well as on
 * the listing — a rider who read a delivery yesterday holds its identifier, and a `show`
 * with no bound would hand back the recipient and the address for as long as the row exists
 * — so this screen and the delivery screen behind it age out together. If they did not,
 * only the weaker of the two would be true.
 *
 * ACTIVE WORK IS NEVER IN THIS LIST AND IS NEVER AGED OUT OF THE OTHER ONE. The window
 * applies to finished deliveries alone; a package still assigned to this rider stays on the
 * round however long it has been sitting there, because a package that disappeared from a
 * rider's list because it got old is a package nobody delivers.
 *
 * NEWEST FIRST, WHERE THE ROUND IS OLDEST FIRST. A work queue is read from the front; a
 * record of what you just did is read from the back. The server decides that ordering and
 * it is named here so nobody adds a sort of their own on top of it.
 *
 * THE PAYLOAD IS THE SAME `RiderDeliveryResource` AS THE ROUND. Finished work does not get
 * a wider projection than live work — it gets a narrower window. There is still no
 * diagnosis, no clinical note, no prescription and no medicine list, because there is no
 * such property on the type.
 */
export async function listCompleted(cursor?: string | undefined): Promise<AssignmentsPage> {
  const client = await readClient()

  return client.get<AssignmentsPage>('/v1/rider/deliveries', {
    query: { status: 'completed', cursor },
  })
}

/**
 * One assignment, or null.
 *
 * NULL FOR 404 AND 403 ALIKE, AND THE ROUTE MUST RENDER THE SAME PAGE FOR BOTH. A 403
 * would confirm that the delivery exists somewhere — which, on a system where the mere
 * fact that someone is a patient of a named clinic is special-category data, is exactly
 * the disclosure the rule about cross-tenant reads being 404 exists to prevent. A rider
 * who is handed a colleague's delivery id must learn nothing from the difference between
 * "not yours" and "does not exist".
 */
export async function getAssignment(id: string): Promise<RiderDelivery | null> {
  try {
    const client = await readClient()
    const response = await client.get<{ data: RiderDelivery }>(
      `/v1/rider/deliveries/${encodeURIComponent(id)}`,
    )

    return response.data ?? null
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null
    }

    // Everything else, including Next's own control-flow throws, goes up untouched. The
    // caller decides what an unreachable API means on its screen; this function only
    // decides what "no such delivery for you" means.
    throw error
  }
}

/** What a status change did, with no exception left for the caller to interpret. */
export type StatusOutcome =
  /** The move landed on this attempt. */
  | { kind: 'changed'; delivery: RiderDelivery }
  /**
   * The delivery was already there. Not a failure and never shown as one — see the long
   * note below. `delivery` is the record as it actually stands.
   */
  | { kind: 'already'; delivery: RiderDelivery }
  | { kind: 'problem'; problem: StatusProblem; message: string | null }

/**
 * Move a delivery, and make the answer survive a bad connection.
 *
 * ==================================================================
 * THIS FUNCTION IS MOSTLY ERROR HANDLING, AND THAT IS THE POINT OF IT.
 * ==================================================================
 *
 * The happy path is four lines. Everything else is here because of who presses this
 * button: somebody outdoors, on a mid-range Android phone, on mobile data that drops
 * between cells, with one hand free. For that person the difference between "it did not
 * work" and "you have already done it" is the difference between riding on and standing
 * in the road pressing a button that will never succeed.
 *
 * THE ENDPOINT IS NOT IDEMPOTENT. `ApiClient` will happily send an `Idempotency-Key` and
 * `RiderDeliveryController::updateStatus()` stores none, so it would be decoration —
 * worse than decoration, because it would read as protection that is not there. What
 * actually happens on a repeated POST is that the state machine refuses it:
 * `assertCanTransitionTo()` throws `IllegalTransition`, which `bootstrap/app.php` renders
 * as a 409 with the message "Cannot transition Delivery from picked_up to picked_up."
 *
 * That message is correct and is not for a rider. Worse, a 409 has two completely
 * different meanings here and the status alone cannot separate them:
 *
 *   (a) the rider's earlier tap DID land and the response was lost coming back — a
 *       tunnel, a cell handover, Android killing the browser to reclaim memory — and they
 *       have pressed it again; or
 *   (b) something genuinely changed underneath them.
 *
 * So a 409 is never reported until the delivery has been RE-READ. If it has already
 * reached the target, the work is done and the screen says so. Only if it landed
 * somewhere else is there a conflict worth a rider's attention.
 *
 * THE SAME RE-READ RUNS AFTER A TRANSPORT FAILURE, and that case is the more common one.
 * When `fetch` rejects, the request may have reached the API and been committed — nothing
 * about a broken socket says otherwise. Reporting "that did not work" without looking
 * would teach riders that the button lies, which is how a status trail stops being worth
 * having.
 *
 * WHY THE RE-READ IS SAFE TO DO UNCONDITIONALLY: it is a GET on the one record the rider
 * is already authorised for, it costs one small round trip on the failure path only, and
 * it is the only thing on this surface that can tell (a) from (b).
 */
export async function setStatus(
  id: string,
  target: DeliveryStatus,
  failureReason?: string | undefined,
): Promise<StatusOutcome> {
  /*
   * Checked here as well as on the server, and the duplication is deliberate rather than
   * defensive. `Delivery::fail()` validates against `FAILURE_REASONS` and throws — which
   * surfaces as a 409 carrying the whole list of codes in its message, on a rider's
   * screen, in the road. Catching it before it is sent means the one case where this can
   * happen (a form posted from a stale page after the list changed) reads as "choose a
   * reason" rather than as a wall of snake_case.
   */
  if (target === 'failed' && (failureReason === undefined || !isFailureReason(failureReason))) {
    return { kind: 'problem', problem: 'invalid', message: null }
  }

  // Typed as the generated request schema, so a renamed or added field on the contract
  // stops this compiling rather than being quietly ignored by the API.
  const body: StatusBody = { status: target }

  // Assigned only when present rather than passed as undefined: exactOptionalPropertyTypes
  // draws a distinction between "absent" and "explicitly undefined", and an explicit
  // `failure_reason: undefined` would be serialised as a key with a null value.
  if (failureReason !== undefined) {
    body.failure_reason = failureReason
  }

  try {
    const client = await writeClient()
    const response = await client.post<{ data: RiderDelivery }>(
      `/v1/rider/deliveries/${encodeURIComponent(id)}/status`,
      body,
    )

    return { kind: 'changed', delivery: response.data }
  } catch (error) {
    return diagnose(error, id, target)
  }
}

/**
 * Which of the things that can go wrong went wrong — after checking whether anything
 * actually did.
 */
async function diagnose(
  error: unknown,
  id: string,
  target: DeliveryStatus,
): Promise<StatusOutcome> {
  // Control flow first — a swallowed `redirect()` or `DynamicServerError` fails silently
  // rather than loudly. See `attempt()` in the identity domain for the whole reasoning.
  unstable_rethrow(error)

  if (error instanceof ApiError) {
    /*
     * 403 and 404 collapse to one answer, exactly as `getAssignment()` does. The rider is
     * no longer the assigned rider — reassigned mid-round, or role revoked — and the
     * screen's job is to send them back to a list that is true, not to explain which of
     * the two it was.
     */
    if (error.status === 403 || error.status === 404) {
      return { kind: 'problem', problem: 'refused', message: null }
    }

    if (error.status === 422) {
      // `required_if:status,failed` is the only validation rule on this endpoint, so a
      // 422 means the reason did not arrive. The API's own sentence is the right one.
      return { kind: 'problem', problem: 'invalid', message: error.message }
    }

    if (error.status === 409) {
      return await reconcile(id, target, 'conflict', error.message)
    }

    return { kind: 'problem', problem: 'failed', message: error.message }
  }

  /*
   * The request did not complete. It may still have been committed — see the note on
   * `setStatus()` — so look before saying anything. Logged without the delivery's details:
   * a rider payload carries a patient's name, telephone number and home address, and none
   * of that belongs in a log line written because a socket closed.
   */
  console.error('[rider] a status change did not complete', error)

  return await reconcile(id, target, 'failed', null)
}

/**
 * Ask what the delivery actually is now, and answer accordingly.
 *
 * `otherwise` IS THE PROBLEM TO REPORT WHEN THE DELIVERY HAS NOT MOVED, and the two
 * callers pass different values because they are describing genuinely different
 * situations. A 409 that survives the re-read means the API answered and the delivery is
 * somewhere the rider did not expect: `conflict`, and the screen shows the state machine's
 * own sentence. A transport failure that survives the re-read means nothing landed and
 * nothing is known about why: `failed`, and the screen offers the button again. Collapsing
 * the two would tell a rider whose signal dropped that somebody else had moved their
 * delivery, which is both false and alarming.
 *
 * A FAILURE TO RE-READ IS REPORTED AS THE ORIGINAL FAILURE, not as a second one. The
 * rider does not care that the reconciliation call also failed; they care whether they
 * need to press the button again.
 */
async function reconcile(
  id: string,
  target: DeliveryStatus,
  otherwise: StatusProblem,
  message: string | null,
): Promise<StatusOutcome> {
  try {
    const delivery = await getAssignment(id)

    if (delivery && hasReached(delivery.status, target)) {
      return { kind: 'already', delivery }
    }

    return { kind: 'problem', problem: otherwise, message }
  } catch (error) {
    unstable_rethrow(error)

    console.error('[rider] could not re-read a delivery after a failed status change', error)

    return { kind: 'problem', problem: otherwise, message }
  }
}
