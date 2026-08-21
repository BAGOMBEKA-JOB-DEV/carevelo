import { ApiError, type components, type operations } from '@carevelo/api-client'
import { patientApi } from './gateway'

/**
 * Following a delivery. Status milestones, and nothing else, ever.
 *
 * THE RESOURCE HAS NO FIELD FOR CONTENTS AND THIS MODULE MUST NEVER GIVE IT ONE. The
 * endpoint is deliberately narrower than the delivery record: no recipient block, no
 * address, no order items, and not even the free-text `note` on each event — "free text is
 * where clinical content escapes". `DeliveryPolicy` splits `track` from `view` for the
 * same reason, and the patient holds `track` and NOT `view`, so this is the whole of what
 * a patient may see. A component in this domain that wanted a medicine name would have to
 * fetch it from somewhere else; there is nowhere else, and that is the design working.
 *
 * A KNOWN GAP, STATED HERE BECAUSE IT SHAPES EVERY CALLER. There is no patient-facing
 * listing of deliveries — `DeliveryController::index()` authorises `viewAny`, which is
 * clinic staff only — so the route layer must be handed the delivery identifier. A patient
 * cannot discover it from any endpoint they are allowed to call.
 *
 * @see backend/app/Http/Controllers/Api/V1/DeliveryController.php — `tracking()`
 * @see backend/app/Policies/DeliveryPolicy.php — why `track` is not `view`
 */

export type DeliveryStatus = components['schemas']['DeliveryStatus']

type TrackingBody =
  operations['v1.deliveries.tracking']['responses'][200]['content']['application/json']

/**
 * One step the package has taken: a status, and when it happened.
 *
 * ------------------------------------------------------------------------------------
 * A DIVERGENCE BETWEEN THE PUBLISHED CONTRACT AND THE RUNNING API, DECLARED RATHER THAN
 * PAPERED OVER.
 *
 * `docs/40-api/openapi.yaml` types `milestones` as an array of STRINGS, so the generated
 * client says `string[]`. The controller returns an array of OBJECTS —
 * `['status' => $event->to_status, 'occurred_at' => …]` — and `DeliveryApiTest` asserts
 * `data.milestones.0.status`, which is the shape a running server actually sends.
 *
 * Coding to the generated type would compile and then render nothing but `[object Object]`
 * down the page. Coding to the observed shape and calling it done would leave the same
 * defect invisible to the next person. So this type is declared here, at one site, with
 * the divergence named — and the parser below accepts BOTH shapes, because whichever half
 * is corrected first, this screen must keep working for a patient watching a package.
 *
 * WHAT TO DO WITH THIS: fix `openapi.yaml` to describe the object, regenerate the client,
 * then delete `DeliveryMilestone` and the `string` branch of `toMilestone()` and take the
 * type from `TrackingBody` like everything else. It is a spec fix, not a code fix.
 * ------------------------------------------------------------------------------------
 */
export interface DeliveryMilestone {
  status: string
  /** ISO-8601 UTC, as everything else on the wire is. Null if the event lost its clock. */
  occurred_at: string | null
}

/**
 * The tracking view: the contract's own fields, with `milestones` corrected.
 *
 * Everything except `milestones` is taken straight from the generated operation, so a
 * field added to the endpoint arrives here without anybody maintaining a second copy.
 */
export type DeliveryTracking = Omit<TrackingBody['data'], 'milestones'> & {
  milestones: DeliveryMilestone[]
}

export type TrackingResult =
  | { ok: true; tracking: DeliveryTracking }
  | {
      ok: false
      /** 404 covers "no such delivery" and "another clinic's delivery" alike, on purpose. */
      notFound: boolean
      /** The API's own sentence, or null when the request never reached it. */
      message: string | null
    }

/**
 * Where the package has got to.
 *
 * READ FRESH, EVERY TIME. ApiClient sends no cache directives and Next does not cache an
 * uncached fetch in a dynamic render, which is what we want: a tracking page served from
 * a cache is a patient told their medicine is still at the pharmacy while the rider is at
 * the gate. The refresh loop in the components relies on this too.
 */
export async function getDeliveryTracking(id: string): Promise<TrackingResult> {
  try {
    const api = await patientApi()

    // `milestones` is read as unknown deliberately — see the note on DeliveryMilestone.
    const body = await api.get<{ data: Omit<TrackingBody['data'], 'milestones'> & { milestones: unknown } }>(
      `/v1/deliveries/${encodeURIComponent(id)}/tracking`,
    )

    return {
      ok: true,
      tracking: { ...body.data, milestones: toMilestones(body.data.milestones) },
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, notFound: error.status === 404, message: error.message }
    }

    return { ok: false, notFound: false, message: null }
  }
}

/**
 * The delivery has stopped moving, one way or another.
 *
 * Used to switch the refresh loop off. A page that keeps polling a delivered package
 * spends a patient's data bundle on an answer that cannot change.
 */
export function isSettled(status: string): boolean {
  return status === 'delivered' || status === 'failed' || status === 'returned_to_pharmacy'
}

/**
 * Parse whatever `milestones` turns out to be, and drop anything unrecognisable.
 *
 * Dropping rather than rendering: an unparseable entry on this screen would print raw
 * server data into a patient's page, and the one thing this endpoint promises is that
 * nothing unexpected reaches it.
 */
function toMilestones(value: unknown): DeliveryMilestone[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry: unknown): DeliveryMilestone[] => {
    // The shape the published contract describes: a bare status with no timestamp.
    if (typeof entry === 'string') {
      return [{ status: entry, occurred_at: null }]
    }

    if (entry === null || typeof entry !== 'object') {
      return []
    }

    const record = entry as Record<string, unknown>
    const status = record['status']
    const occurredAt = record['occurred_at']

    if (typeof status !== 'string') {
      return []
    }

    return [{ status, occurred_at: typeof occurredAt === 'string' ? occurredAt : null }]
  })
}
