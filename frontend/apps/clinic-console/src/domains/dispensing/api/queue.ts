import { readClient, statusOf } from './http'
import type { DispenseOrder, DispenseOrderPage, DispenseOrderStatus, Viewer } from '../model/types'

/**
 * Reading the pharmacy queue and a single order.
 *
 * ------------------------------------------------------------
 * THE ONE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE: NO OFFSET EVER LEAVES THIS
 * FILE.
 *
 * `GET /v1/dispense-orders` pages by `page`/`per_page`. The house rule is cursor
 * pagination, never offset, and this screen is the reason the rule exists — orders are
 * written into the same table while a pharmacist reads it, and that is exactly the traffic
 * under which an offset duplicates and skips rows. A skipped row here is a patient at the
 * counter whose order the pharmacy never saw.
 *
 * The contract offers no cursor on this endpoint (`GET /v1/tenant/users` in the same API
 * does, so it is a gap in one endpoint rather than a house style). A client cannot invent
 * one: `IndexDispenseOrderRequest` uses `RejectsUnknownFields`, so `?cursor=` is a 422,
 * and the only alternative is the offset we must not send.
 *
 * So this file sends `status` and `per_page` and never `page`. One request per lane, at
 * the endpoint's maximum size, oldest first — `DispenseOrderController::index` orders by
 * `created_at` then `id`, because "a queue is a work list, and the order that has waited
 * longest is the patient sitting in the pharmacy wondering." A lane that overflows the cap
 * is reported as overflowing rather than silently truncated; see `QueueLane`.
 *
 * @see docs/40-api/api-conventions.md
 * @see backend/app/Http/Requests/V1/Dispensing/IndexDispenseOrderRequest.php
 */

/**
 * `IndexDispenseOrderRequest::MAX_PER_PAGE`. Asking for more is a 422, so this number is
 * the contract's and not a preference — it is repeated here because the request has to
 * carry it, and named so the day it changes there is one place to look.
 */
export const MAX_PER_PAGE = 100

export type Lane = {
  status: DispenseOrderStatus
  orders: DispenseOrder[]
  /** How many orders are in this state in total, which may exceed what was returned. */
  total: number
  /** True when the clinic has more waiting in this state than one request can carry. */
  overflowed: boolean
}

/**
 * Every order in one status, oldest first.
 *
 * Throws `ApiError` on failure. Callers inside this domain wrap it in `attempt()`, because
 * a lane that failed to load must not take the other four down with it — a pharmacist with
 * a patient at the counter needs whatever the screen can still show.
 */
export async function listLane(status: DispenseOrderStatus): Promise<Lane> {
  const client = await readClient()

  const page = await client.get<DispenseOrderPage>('/v1/dispense-orders', {
    query: { status, per_page: MAX_PER_PAGE },
  })

  return {
    status,
    orders: page.data,
    total: page.meta.total,
    overflowed: page.meta.total > page.data.length,
  }
}

/**
 * One order, in full: the prescription, its items, the dispensed lines and every
 * substitution.
 *
 * A CROSS-TENANT ID IS A 404, NOT A 403, and this function passes that through untouched.
 * The distinction is the disclosure: a 403 would confirm the record exists somewhere,
 * which is how you learn that a named person is a patient of another clinic. Callers must
 * not "helpfully" explain the difference either.
 *
 * THIS READ IS AUDITED SERVER-SIDE. `DispenseOrderController::show` records
 * `dispense_order.read` on every call, because "who looked at my records?" can only be
 * answered by having recorded every look. Which is worth knowing before adding a
 * speculative prefetch: every prefetch becomes a line in somebody's access history.
 */
export async function getOrder(id: string): Promise<DispenseOrder> {
  const client = await readClient()
  const response = await client.get<{ data: DispenseOrder }>(`/v1/dispense-orders/${id}`)

  return response.data
}

/**
 * Who is signed in.
 *
 * Lives here rather than in an identity domain because this app has no identity domain
 * yet — `src/domains/identity/index.ts` is still an empty public surface — and a screen
 * cannot decide which controls to offer without knowing the viewer's roles. When identity
 * lands, this function moves there and both consumers import it from that domain's index.
 *
 * `null` MEANS NOT SIGNED IN, and is not an error. Every other failure throws, because a
 * console that cannot reach the API should say so rather than render as though nobody is
 * signed in — those two states look identical to a pharmacist and mean completely
 * different things.
 */
export async function currentStaff(): Promise<Viewer | null> {
  const client = await readClient()

  try {
    // UNWRAPPED. `GET /v1/me` returns MeResource, and an Eloquent API resource nests its
    // payload under `data`. The patient portal shipped the flat read once and every field
    // came back undefined — a signed-in user rendering as a blank name rather than failing
    // loudly, which is the worst way for this to be wrong.
    const response = await client.get<{ data: Viewer }>('/v1/me')

    return response.data
  } catch (error) {
    if (statusOf(error) === 401) {
      return null
    }

    throw error
  }
}
