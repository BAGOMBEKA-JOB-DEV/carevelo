import { ApiError, type components } from '@carevelo/api-client'
import { patientApi, postAsPatient, type WriteResult } from './gateway'

/**
 * The fulfilment decision: collect at the pharmacy, or have a rider bring it.
 *
 * WHY THIS LIVES IN THE DELIVERY DOMAIN AND NOT IN DISPENSING. The endpoint hangs off a
 * dispense order, but the decision it records is the one that either does or does not put
 * a patient's home address in a stranger's hands. Everything interesting about it is a
 * delivery concern: the controlled-item exclusion, the service area, and above all the
 * `delivery_disclosure` consent that must exist before the word `delivery` may be sent.
 * Filing it under dispensing would put the consent gate one domain away from the tracking
 * screen that depends on it.
 *
 * THE TWO REFUSALS, BOTH ENFORCED SERVER-SIDE AND BOTH WORTH ANTICIPATING HERE:
 *
 *   1. An order holding a CONTROLLED medicine can never be delivered (NDPA Act Cap 206).
 *      There is no override. `DispenseOrder::mayBeDelivered()` asks the prescription, and
 *      because `show` loads `prescription.items` this domain can ask the same question
 *      before the patient chooses — so they are told while they can still act on it,
 *      rather than after submitting.
 *   2. Delivery requires the patient's `delivery_disclosure` consent to ALREADY exist.
 *      This module deliberately does not write it. Consent under DPPA 2019 pins the exact
 *      wording the patient read, plus a hash taken over that rendered text, and
 *      ConsentController owns both — "a second writer here would pin a hash to text it had
 *      reproduced by hand, which is precisely the failure the hash exists to catch". The
 *      same argument applies one layer out: the patients domain owns the consent capture,
 *      and this domain routes the patient to it rather than duplicating the call.
 *
 * @see backend/app/Http/Controllers/Api/V1/DispenseOrderController.php — `fulfilment()`
 * @see backend/app/Support/Consent/DeliveryDisclosure.php
 */

export type DispenseOrder = components['schemas']['DispenseOrderResource']
export type DispenseOrderStatus = components['schemas']['DispenseOrderStatus']

/**
 * The two values `RecordFulfilmentRequest` accepts.
 *
 * Two, and no default. The backend's comment is the whole argument: "A default here would
 * be a guess about something the patient has to be asked — and if the guess were
 * `delivery`, it would be a guess that their address may be shared with a rider." The form
 * in this domain therefore pre-selects nothing.
 */
export type FulfilmentMethod = components['schemas']['RecordFulfilmentRequest']['method']

export type OrderResult =
  | { ok: true; order: DispenseOrder }
  | {
      ok: false
      /** 404 covers "no such order" and "another clinic's order" alike, on purpose. */
      notFound: boolean
      /** The API's own sentence, or null when the request never reached it. */
      message: string | null
    }

/**
 * One dispense order, with its prescription and its items.
 *
 * `DispenseOrderController::show()` authorises through `DispenseOrderPolicy::view()`,
 * which admits the patient of the order, and loads `prescription.items` — which is what
 * makes the controlled-item question answerable below.
 *
 * THE GAP THAT SHAPED EVERY CALLER OF THIS FILE IS CLOSED. There used to be no
 * patient-facing LISTING of dispense orders: `index()` authorised `viewAny`, clinic staff
 * only, and did not use `AuthorisesPatientReads` — so a patient could open an order they
 * held the identifier for and could not discover that identifier from anywhere in the API.
 * The route layer had to be handed the id, from a URL the clinic sent. That controller now
 * branches on the trait, and the DISPENSING domain owns the listing — `listDispenseOrders()`
 * on `domains/dispensing`, filed there because it reads orders rather than because it
 * decides anything about delivery. This function is unchanged: `show` is still the read
 * that loads `prescription.items`, which is what makes the controlled-item question
 * answerable before a patient chooses.
 */
export async function getDispenseOrder(id: string): Promise<OrderResult> {
  try {
    const api = await patientApi()
    const body = await api.get<{ data: DispenseOrder }>(
      `/v1/dispense-orders/${encodeURIComponent(id)}`,
    )

    return { ok: true, order: body.data }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, notFound: error.status === 404, message: error.message }
    }

    return { ok: false, notFound: false, message: null }
  }
}

/**
 * Record how the patient wants their medicines.
 *
 * Answers 409 — surfaced as `refused` — when the order holds a controlled item or when
 * the delivery consent is absent. Both sentences come back from the API in its own words
 * and are shown unchanged: the controlled-item refusal already offers collection as the
 * alternative, because "not permitted" without an alternative is not an answer a patient
 * standing at a counter can act on.
 */
export async function recordFulfilment(
  orderId: string,
  method: FulfilmentMethod,
): Promise<WriteResult> {
  return postAsPatient(`/v1/dispense-orders/${encodeURIComponent(orderId)}/fulfilment`, { method })
}

/**
 * Whether anything on this order must be collected in person.
 *
 * Mirrors `DispenseOrder::mayBeDelivered()`, which asks the PRESCRIPTION rather than the
 * dispensed items — an item can be unfulfilled or substituted, and the exclusion follows
 * what was prescribed either way.
 *
 * WHEN THE PRESCRIPTION IS NOT LOADED, THIS SAYS "no". That is the honest answer to a
 * question this function cannot answer, not an assertion that delivery is safe: `show`
 * always loads it, and the API refuses the delivery regardless. What must never happen is
 * the reverse — silently hiding the delivery option on an order whose contents we simply
 * did not fetch.
 */
export function hasControlledItem(order: DispenseOrder): boolean {
  return (order.prescription?.items ?? []).some((item) => item.is_controlled)
}

/**
 * Statuses past which asking the question again is meaningless.
 *
 * Once the package has left the pharmacy or been handed over, the fulfilment method is a
 * fact rather than a choice, and a form offering to change it would be offering something
 * the state machine will refuse. The screen shows what was chosen instead.
 */
const DECIDED: ReadonlySet<string> = new Set<DispenseOrderStatus>([
  'out_for_delivery',
  'collected',
  'completed',
  'returned',
  'refund_pending',
  'cancelled',
  'rejected',
])

export function fulfilmentIsStillOpen(order: DispenseOrder): boolean {
  return !DECIDED.has(order.status)
}
