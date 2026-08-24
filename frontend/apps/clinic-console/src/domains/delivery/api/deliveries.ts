import { readClient, statusOf } from './http'
import type {
  Delivery,
  DeliveryPage,
  DeliveryStatus,
  DispatchAbilities,
  Staff,
  Tracking,
} from '../model/types'
import type { components } from '@carevelo/api-client'

/**
 * Reading the dispatch board, one delivery, and the riders who can carry it.
 *
 * NO OFFSET EVER LEAVES THIS FILE. `GET /v1/deliveries` pages by `per_page` and Laravel's
 * implicit `page`; the house rule is cursor pagination and this board is exactly the
 * traffic the rule is about. One request per lane, at the maximum page size, oldest first —
 * `DeliveryController::index` orders by `created_at` because "a dispatch board is a work
 * queue, and the delivery that has been waiting longest is the one a patient is wondering
 * about." A lane that overflows the cap is reported rather than silently truncated.
 */

/** `DispatchBoardRequest` validates `per_page` at `max:100`. Asking for more is a 422. */
export const MAX_PER_PAGE = 100

export type Lane = {
  status: DeliveryStatus
  deliveries: Delivery[]
  total: number
  overflowed: boolean
}

/**
 * Every delivery in one status, oldest first.
 *
 * Throws `ApiError`. Callers wrap it in `attempt()`, so a lane that fails renders its own
 * failure and the rest of the board still works.
 */
export async function listLane(status: DeliveryStatus): Promise<Lane> {
  const client = await readClient()

  const page = await client.get<DeliveryPage>('/v1/deliveries', {
    query: { status, per_page: MAX_PER_PAGE },
  })

  return {
    status,
    deliveries: page.data,
    total: page.meta.total,
    overflowed: page.meta.total > page.data.length,
  }
}

/**
 * One delivery's full record.
 *
 * A CROSS-TENANT ID IS A 404, NOT A 403, and this passes it through untouched. The
 * distinction is the disclosure: a 403 would confirm the record exists somewhere, which is
 * how you learn that a named person is a patient of another clinic.
 */
export async function getDelivery(id: string): Promise<Delivery> {
  const client = await readClient()
  const response = await client.get<{ data: Delivery }>(`/v1/deliveries/${id}`)

  return response.data
}

/**
 * The status thread, as the patient sees it.
 *
 * MILESTONES ONLY — no recipient block, no address, no order contents, no event note. That
 * is the endpoint's design and not a subset this client chose: `DeliveryController::tracking`
 * reads `to_status` and a timestamp and deliberately does not read the event's `note`
 * column, "because it is free text, and free text is where clinical content escapes."
 *
 * Shown to the dispatcher because it is the one view that says what the PATIENT is
 * currently being told. A dispatcher on the telephone to somebody asking "where is my
 * package" should be reading the same thing that person is looking at.
 */
export async function getTracking(id: string): Promise<Tracking> {
  const client = await readClient()
  const response = await client.get<{ data: Tracking }>(`/v1/deliveries/${id}/tracking`)

  return response.data
}

/**
 * The clinic's riders, for the assignment picker.
 *
 * ------------------------------------------------------------
 * RETURNS `null` WHEN THIS VIEWER MAY NOT LIST STAFF, AND THAT IS THE NORMAL CASE.
 *
 * `GET /v1/tenant/users` is administrator-only — `StaffController::administeredTenant()`
 * throws unless the caller holds `clinic_admin` — while assigning a rider is open to the
 * administrator AND the dispatcher. So the person who does this job all day is precisely
 * the person who cannot fetch the list of names.
 *
 * The answer is not to widen an administrative endpoint for a picker. It is for the form to
 * degrade: an administrator gets a dropdown, a dispatcher types the rider's identifier, and
 * `AssignRiderRequest` validates it — "no such user", "user of another clinic" and "not a
 * rider" all answered with one message on purpose, because a distinguishable response turns
 * that field into a directory of other clinics' staff.
 *
 * `null` therefore means "not available to you", never "this clinic has no riders". The two
 * look identical in an empty dropdown and mean completely different things, which is why
 * they are different values here.
 */
export async function listRiders(): Promise<Staff[] | null> {
  const client = await readClient()

  try {
    const response = await client.get<{ data: Staff[] }>('/v1/tenant/users')

    return response.data.filter((person) => person.roles.includes('rider') && person.is_active)
  } catch (error) {
    const status = statusOf(error)

    if (status === 403 || status === 401) {
      return null
    }

    throw error
  }
}

/**
 * Who is signed in.
 *
 * A SECOND COPY OF `currentStaff()`, and it is here rather than imported from the
 * dispensing domain on purpose. Reaching into that domain's internals is a build failure,
 * and importing it from that domain's PUBLIC SURFACE would make the dispatch board depend
 * on the pharmacy for the answer to "who am I" — which is neither domain's business. It
 * belongs to an identity domain; `src/domains/identity/index.ts` exists and is still empty.
 * When it is filled in, both copies delete and both domains import it from there.
 */
export async function currentStaff(): Promise<components['schemas']['MeResource'] | null> {
  const client = await readClient()

  try {
    // Unwrapped: `MeResource` nests under `data` like every Eloquent API resource.
    const response = await client.get<{ data: components['schemas']['MeResource'] }>('/v1/me')

    return response.data
  } catch (error) {
    if (statusOf(error) === 401) {
      return null
    }

    throw error
  }
}

/**
 * What this member of staff may be offered on the board.
 *
 * Straight out of `DeliveryPolicy` and `docs/50-security-compliance/rbac-matrix.md`:
 *
 *  - the BOARD is administrator, dispatcher or pharmacist. Riders never see it — that is
 *    the first line of the policy, and it is the whole point of the separate rider surface.
 *  - ASSIGNING is administrator or dispatcher only. A rider does not assign work, to
 *    themselves or to anyone else.
 *  - LISTING STAFF is administrator only, which is why the rider picker degrades. See
 *    `listRiders()`.
 *
 * None of this is the security boundary. Every one of those policies runs again on the API.
 */
export function abilitiesOf(
  viewer: components['schemas']['MeResource'] | null,
): DispatchAbilities {
  const roles = new Set(viewer?.roles ?? [])
  const admin = roles.has('clinic_admin')
  const dispatcher = roles.has('dispatcher')

  return {
    seesTheBoard: admin || dispatcher || roles.has('pharmacist'),
    assignsRiders: admin || dispatcher,
    listsStaff: admin,
  }
}
