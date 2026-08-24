import { ApiError } from '@carevelo/api-client'
import { patientApi } from './gateway'
import { toMilestones, type DeliveryMilestone } from './tracking'

/**
 * The patient's own deliveries — the list that lets them find the one to follow.
 *
 * WHY THIS EXISTS NOW AND DID NOT BEFORE. `DeliveryPolicy::viewOwn()` has admitted a
 * patient since it was written and nothing called it, so a patient could `track` a delivery
 * only if they ALREADY held its identifier — and nothing they were allowed to call ever
 * handed them one. The whole journey of watching a package therefore had no entry point in
 * the portal: it opened from a link the clinic sent, or not at all.
 * `DeliveryController::index()` now branches on `AuthorisesPatientReads`, which authorises
 * and narrows in the same call, and this is the portal's half of that.
 *
 * ==================================================================
 * THE PROJECTION IS THE POINT, AND IT IS NOT THE DISPATCHER'S
 * ==================================================================
 *
 * The patient branch renders `PatientDeliveryResource`, a THIRD resource class — one per
 * audience, rather than one class with conditionals in it. It carries a reference, a
 * status, two timestamps and the milestone thread. It does NOT carry the recipient block,
 * the street address, the landmark, the rider, or `failure_reason`, and each of those
 * omissions is argued field by field in that class. `DeliveryPolicy` splits `track` from
 * `view` for the same reason and gives the patient only `track`, so this is the whole of
 * what a patient may see in a list — and this module must never give it more. A component
 * in this domain that wanted a medicine name would have to fetch it from somewhere else;
 * there is nowhere else, and that is the design working.
 *
 * `failure_reason` IS THE ONE WORTH RESTATING, because it looks like an omission and is a
 * decision. It is not clinical and the patient is entitled to it — they are told it in full
 * on the tracking screen, which is the page they reach by opening one delivery. It is out
 * of the LIST because a list is read at a glance and often not by its owner: "refused" or
 * "recipient_unreachable" against a row is a statement about a household, legible to
 * anybody holding the phone.
 *
 * @see backend/app/Http/Resources/V1/PatientDeliveryResource.php
 * @see backend/app/Http/Controllers/Api/V1/DeliveryController.php — `index()`
 * @see backend/app/Policies/DeliveryPolicy.php — why `track` is not `view`
 */

/**
 * One row of a patient's delivery list.
 *
 * ------------------------------------------------------------------------------------
 * DECLARED HERE BECAUSE THE PUBLISHED CONTRACT DOES NOT DESCRIBE IT — the same kind of
 * divergence `DeliveryMilestone` carries in ./tracking.ts, and stated for the same reason.
 *
 * `docs/40-api/openapi.yaml` describes `GET /v1/deliveries` as the DISPATCH BOARD and
 * nothing else: it types `data` as `DeliveryResource[]` — the dispatcher's projection, with
 * the address and the rider on it — and `meta` as an OFFSET paginator. The running API
 * answers a PATIENT with `PatientDeliveryResource` and a CURSOR paginator, neither of which
 * has a schema in that file. Coding to the generated type would compile and then be wrong
 * in the worst available direction: it would describe a payload as carrying a street
 * address that the server deliberately does not send, which is exactly the sort of type
 * somebody later writes a component against.
 *
 * So the row is written out below, narrow, matching what the server actually sends.
 *
 * WHAT TO DO WITH THIS: add `PatientDeliveryResource` and the patient branch's cursor meta
 * to `openapi.yaml`, regenerate the client, then delete this interface and take it from the
 * operation like everything else. It is a specification fix, not a code fix, and it is not
 * made here because this change does not own that file.
 * ------------------------------------------------------------------------------------
 */
export interface PatientDelivery {
  id: string
  reference: string
  /** A plain string, as the resource sends it. ./components/status.ts maps it to words. */
  status: string
  /** ISO-8601 UTC. Null until a dispatcher has handed it to a rider. */
  assigned_at: string | null
  /** ISO-8601 UTC. Null unless it actually arrived — a failed delivery never sets it. */
  delivered_at: string | null
  /** The status thread. Eager-loaded by the controller so a page of rows is one query. */
  milestones: DeliveryMilestone[]
}

/** The cursor block the patient branch actually sends. See the note on `PatientDelivery`. */
interface CursorMeta {
  next_cursor: string | null
  prev_cursor: string | null
}

export interface DeliveryPage {
  deliveries: PatientDelivery[]
  /** Opaque. Feed it back as `cursor`; never parse it, never construct one. */
  nextCursor: string | null
  prevCursor: string | null
}

/**
 * The result shape, matching the rest of this domain.
 *
 * A THROWN ERROR WOULD BE THE WRONG SHAPE HERE. This is read from a Server Component, and
 * an exception in one becomes the framework's error boundary — a blank screen where a
 * patient expected to find their package. Worse, an empty list and a failed request would
 * look identical, and on this screen "you have no deliveries" read as fact is a patient who
 * stops waiting in for one.
 */
export type DeliveryListResult =
  | { ok: true; page: DeliveryPage }
  | {
      ok: false
      /** 404 covers "no such delivery" and "another clinic's delivery" alike, on purpose. */
      notFound: boolean
      /** The API's own sentence, or null when the request never reached it. */
      message: string | null
    }

/** A screenful on a phone. The API's ceiling lives in DispatchBoardRequest. */
const PER_PAGE = 20

/**
 * The patient's own deliveries, newest first.
 *
 * NEWEST FIRST, WHICH IS THE OPPOSITE OF THE DISPATCH BOARD, because the two are different
 * objects. The board is a work queue and the oldest item is the one somebody is waiting on;
 * this is a person's own history, and the delivery they came to look at is almost always
 * the last one. The server decides that ordering; it is named here so nobody adds a sort of
 * their own on top of it.
 *
 * NOTHING IS SENT THAT NARROWS IT. There is no `patient_id` on a delivery at all — ownership
 * resolves one hop away through the dispense order — and `rider_id` is a dispatch-board
 * control that the patient projection names no rider for, so a patient could send it and
 * never see the effect, which is an invitation to probe with it. The trait does the
 * narrowing; this function has nothing to scope.
 *
 * READ FRESH, EVERY TIME. ApiClient sends no cache directives and Next does not cache an
 * uncached fetch in a dynamic render, which is what we want here: a delivery list served
 * from a cache tells a patient their medicine is still at the pharmacy while the rider is
 * at the gate.
 *
 * CURSOR, NEVER OFFSET. The dispatcher is assigning and riders are moving packages through
 * the same table while the patient reads it, which is exactly the traffic under which an
 * offset paginator duplicates and skips rows — and a skipped row here is a delivery nobody
 * goes to the gate for.
 */
export async function listDeliveries(
  options: { cursor?: string | undefined } = {},
): Promise<DeliveryListResult> {
  try {
    const api = await patientApi()

    // `milestones` is read as unknown deliberately — see the note on DeliveryMilestone in
    // ./tracking.ts, and `toMilestones()` there, which is the one parser for both screens.
    const body = await api.get<{
      data: (Omit<PatientDelivery, 'milestones'> & { milestones: unknown })[]
      meta: CursorMeta
    }>('/v1/deliveries', {
      query: {
        per_page: PER_PAGE,
        // Dropped by the client when undefined rather than sent as the string
        // "undefined", which would be a 422 on the first page.
        cursor: options.cursor,
      },
    })

    return {
      ok: true,
      page: {
        deliveries: body.data.map((row) => ({
          ...row,
          milestones: toMilestones(row.milestones),
        })),
        // `?? null` rather than trusting the field to be there: this block is not in the
        // published contract, so it is read defensively at the one place it is read at
        // all. A missing cursor is "no further page", which is the safe reading — it stops
        // a pager, it never invents one.
        nextCursor: body.meta?.next_cursor ?? null,
        prevCursor: body.meta?.prev_cursor ?? null,
      },
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, notFound: error.status === 404, message: error.message }
    }

    return { ok: false, notFound: false, message: null }
  }
}

/**
 * When this delivery last did anything, as an ISO-8601 instant — or null.
 *
 * THE LAST MILESTONE, NOT `delivered_at` OR `assigned_at`, and the choice matters on the
 * two rows a patient looks hardest at. A failed delivery and one returned to the pharmacy
 * never set `delivered_at`, so a row that showed only that column would print a dash beside
 * the two states somebody most wants a time for. The thread has an entry for every
 * transition, so its last entry is the moment the package last moved whatever it did.
 *
 * SORTED BY THE SERVER, not here. `PatientDeliveryResource::milestones()` orders by
 * `occurred_at` with an id tiebreak — two transitions can land in the same second, and the
 * ULID is monotonic where the timestamp has run out of resolution — so the last element is
 * the latest and re-sorting in the browser would only be a second opinion able to disagree.
 *
 * Falls back to `assigned_at`, then to null, for a delivery whose thread has not been
 * written yet. Null renders as a dash rather than as "now", because a made-up time on this
 * screen is a patient told their package moved when it did not.
 */
export function lastMovedAt(delivery: PatientDelivery): string | null {
  const latest = delivery.milestones.at(-1)

  return latest?.occurred_at ?? delivery.assigned_at ?? null
}
