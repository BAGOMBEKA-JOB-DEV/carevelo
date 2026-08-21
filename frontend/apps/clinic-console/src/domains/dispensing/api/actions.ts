'use server'

import { revalidatePath } from 'next/cache'
import { writeClient, sentence } from './http'
import { getOrder } from './queue'
import { parseQuantity, parseWholeShillings } from '../model/money'
import { itemViews, mayBeDelivered } from '../model/order'
import type { DispenseOrder, PriceRequestItem } from '../model/types'

/**
 * Everything the pharmacy bench does, as Server Actions.
 *
 * ------------------------------------------------------------
 * THE PRESCRIPTION IS NEVER EDITED. NOT HERE, NOT ANYWHERE.
 *
 * There is no call in this file to any `/v1/prescriptions/...` endpoint, and there never
 * will be one. A prescription is a clinical document; what was PRESCRIBED and what was
 * DISPENSED are different facts, and both have to survive independently or a substitution
 * and a partial fill become invisible after the event. Every action below writes to the
 * dispense order, which is why the two are separate aggregates in the first place.
 *
 * ------------------------------------------------------------
 * WHY EVERY ACTION RETURNS A STATE INSTEAD OF THROWING.
 *
 * These are `useActionState` actions. A thrown error becomes the framework's error
 * boundary, which replaces the bench with an apology and loses everything the pharmacist
 * typed. The API's own sentence is more useful than anything this layer could invent —
 * `ApiError` has already put RFC 9457 problem details through `humanise()`, and the
 * refusals this endpoint produces are written for exactly this reader: "This order
 * contains a controlled medicine and must be collected in person."
 *
 * ------------------------------------------------------------
 * NO IDEMPOTENCY KEYS, DELIBERATELY.
 *
 * `ApiClient` will set one on request; none of these endpoints stores one, so it would be
 * decoration. What actually stops a double submit becoming two dispenses is the state
 * machine: every transition below is legal from exactly one state, so the second attempt
 * is an `IllegalTransition` rendered as a 409, and the pharmacist is told the order has
 * already moved. (Payments are a different matter, and `PaymentIntentController` requires
 * a key for exactly the reason these do not.)
 */

/** What a bench action did. `null` message means the request never reached the API. */
export type BenchState =
  | { status: 'idle' }
  | { status: 'done'; order: DispenseOrder }
  | { status: 'refused'; message: string | null; fields?: Record<string, string> }

export const IDLE: BenchState = { status: 'idle' }

/**
 * Re-render every screen that shows this order.
 *
 * The queue and the order share a source of truth and are two routes, so a dispense that
 * only refreshed the order would leave the queue showing work that is already done — and
 * a pharmacist would pick it up again. `revalidatePath` with no second argument
 * invalidates that path's whole cache entry, which is what a live worklist wants.
 */
function refresh(paths: readonly string[]): void {
  for (const path of paths) {
    revalidatePath(path)
  }
}

/**
 * Take the order to the bench: received → under_review.
 *
 * Opening an order twice is an `IllegalTransition` rendered as 409, which is the right
 * answer rather than a bug: two pharmacists reaching for the same order is a real event on
 * a busy bench, and the second one deserves to be told.
 */
export async function openOrder(
  paths: readonly string[],
  _previous: BenchState,
  form: FormData,
): Promise<BenchState> {
  const id = String(form.get('order_id') ?? '')

  try {
    const client = await writeClient()
    const response = await client.post<{ data: DispenseOrder }>(`/v1/dispense-orders/${id}/open`)

    refresh(paths)

    return { status: 'done', order: response.data }
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }
}

/**
 * Price the order at the clinic's own prices, recording what will be filled.
 *
 * ------------------------------------------------------------
 * EVERY PRESCRIBED ITEM IS SENT, EVERY TIME. That is not defensive coding, it is the
 * endpoint's contract: `assertItemsMatchPrescription` refuses a payload that leaves an
 * item out, because "an item left out is one the patient is never told they did not
 * receive." So this function builds its lines from the PRESCRIPTION and reads the form for
 * each one, rather than iterating whatever the form happened to contain — a browser that
 * drops a disabled input must not silently drop a medicine.
 *
 * A PENDING SUBSTITUTION BLOCKS ONLY ITS OWN ITEM. The affected line is omitted from the
 * payload — the API refuses to price a blocked item — and everything else prices normally.
 * That single behaviour is the difference between pharmacists using this system and
 * working around it: stall the whole order on one missing box and they will price it on
 * paper.
 *
 * PRICES ARE TYPED IN WHOLE SHILLINGS AND SENT AS MINOR UNITS. See model/money.ts; the
 * factor is a hundred and getting it wrong overcharges by two orders of magnitude.
 *
 * AN UNFULFILLED LINE MUST SAY WHY. `unit_price_minor` is still required by the validator
 * even for a line nobody is charged for, so an unfulfilled item is sent as zero at zero —
 * `PriceDispenseOrderRequest`'s controller only adds a line to the subtotal when
 * `is_fulfilled`, so there is no way for that zero to reach a patient's total.
 */
export async function priceOrder(
  paths: readonly string[],
  _previous: BenchState,
  form: FormData,
): Promise<BenchState> {
  const id = String(form.get('order_id') ?? '')

  let order: DispenseOrder

  try {
    // Re-read rather than trusting a hidden field. The list of prescribed items decides
    // the shape of this payload, and a list posted by the browser is a list somebody can
    // edit — which would let a crafted form drop an item from an order it does not own.
    order = await getOrder(id)
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }

  const items: PriceRequestItem[] = []
  const fields: Record<string, string> = {}

  for (const view of itemViews(order)) {
    const itemId = view.prescribed.id

    // Blocked by its own pending proposal. Omitted, and the rest of the order proceeds.
    if (view.pending) {
      continue
    }

    const fulfilled = form.get(`fulfilled_${itemId}`) === 'on'
    const name = String(form.get(`name_${itemId}`) ?? '').trim()
    const reason = String(form.get(`reason_${itemId}`) ?? '').trim()

    if (!fulfilled) {
      if (reason === '') {
        fields[`reason_${itemId}`] =
          'Say why this item is not being filled. The clinician needs to see which '
          + 'medicine the patient never received, not a silent gap.'
        continue
      }

      items.push({
        prescription_item_id: itemId,
        // The prescribed name, so the record still says which item went unfilled.
        medicine_name_dispensed: name === '' ? view.prescribed.medicine_name : name,
        quantity_dispensed: 0,
        unit_price_minor: 0,
        is_fulfilled: false,
        unfulfilled_reason: reason,
      })

      continue
    }

    if (name === '') {
      fields[`name_${itemId}`] = 'Record what is actually going in the bag.'
      continue
    }

    const quantity = parseQuantity(String(form.get(`quantity_${itemId}`) ?? ''))

    if (!quantity.ok) {
      fields[`quantity_${itemId}`] = 'A whole number of units.'
      continue
    }

    const price = parseWholeShillings(String(form.get(`price_${itemId}`) ?? ''))

    if (!price.ok) {
      fields[`price_${itemId}`] =
        price.reason === 'not_a_whole_number'
          ? 'Whole shillings only. Ugandan shillings have no subunit in use, so there is no '
            + 'decimal to enter.'
          : 'A price in whole shillings.'
      continue
    }

    const line: PriceRequestItem = {
      prescription_item_id: itemId,
      medicine_name_dispensed: name,
      quantity_dispensed: quantity.value,
      unit_price_minor: price.minor,
      is_fulfilled: true,
    }

    /*
     * A substitute may only be filled against an APPROVED substitution, and the controller
     * refuses the id otherwise. Sending it is what ties the dispensed line back to the
     * clinician who allowed it — `DispenseItemResource.substitution_id` exists so a
     * substitute is traceable years later.
     */
    if (view.approved && name !== view.prescribed.medicine_name) {
      line.substitution_id = view.approved.id
    }

    items.push(line)
  }

  if (Object.keys(fields).length > 0) {
    return { status: 'refused', message: null, fields }
  }

  if (items.length === 0) {
    return {
      status: 'refused',
      message:
        'Every item on this order is waiting on a clinician’s decision, so there is nothing '
        + 'to price yet.',
    }
  }

  const fee = parseWholeShillings(String(form.get('delivery_fee') ?? '0'))

  if (!fee.ok && fee.reason !== 'empty') {
    return {
      status: 'refused',
      message: null,
      fields: { delivery_fee: 'A delivery fee in whole shillings, or leave it blank.' },
    }
  }

  try {
    const client = await writeClient()
    const response = await client.post<{ data: DispenseOrder }>(
      `/v1/dispense-orders/${id}/price`,
      { items, delivery_fee_minor: fee.ok ? fee.minor : 0 },
    )

    refresh(paths)

    return { status: 'done', order: response.data }
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }
}

/**
 * Hand the medicine over, against a NAMED pharmacist.
 *
 * NO PHARMACIST FIELD IN THIS PAYLOAD, and that absence is the control. The API takes the
 * dispenser from the authenticated session, never from the body: accepting an identity
 * from the request would let one member of staff dispense in another's name, and
 * attribution is the whole point of the record (NDPA Act Cap 206, acceptance criterion 11).
 *
 * REFUSED WHILE A SUBSTITUTION IS PENDING. `DispenseOrder::dispense()` enforces it, so an
 * unapproved substitute cannot leave the pharmacy. The screen hides the control in that
 * state as well, but the refusal that matters is the one on the API.
 */
export async function dispenseOrder(
  paths: readonly string[],
  _previous: BenchState,
  form: FormData,
): Promise<BenchState> {
  const id = String(form.get('order_id') ?? '')

  try {
    const client = await writeClient()
    const response = await client.post<{ data: DispenseOrder }>(
      `/v1/dispense-orders/${id}/dispense`,
    )

    refresh(paths)

    return { status: 'done', order: response.data }
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }
}

/**
 * Record whether the patient is collecting or having it delivered.
 *
 * CONTROLLED ITEMS CANNOT BE DELIVERED AND THERE IS NO OVERRIDE. This function refuses
 * `delivery` locally before sending it, so the patient is told at the counter rather than
 * after a round trip — the same reason the API refuses here rather than at dispatch. The
 * local check is a courtesy; `DispenseOrderController::fulfilment` is the control.
 *
 * DELIVERY ALSO REQUIRES `delivery_disclosure` CONSENT TO ALREADY EXIST, and this action
 * does not and must not capture it. Capturing consent needs the exact policy wording the
 * patient read and the hash taken over it, and `ConsentController` owns both. A second
 * writer here would pin a hash to text it had reproduced by hand, which is precisely the
 * failure the hash exists to catch. When the consent is missing the API says so, and that
 * sentence is what the pharmacist sees.
 */
export async function chooseFulfilment(
  paths: readonly string[],
  _previous: BenchState,
  form: FormData,
): Promise<BenchState> {
  const id = String(form.get('order_id') ?? '')
  const method = String(form.get('method') ?? '')

  if (method !== 'pickup' && method !== 'delivery') {
    return { status: 'refused', message: 'Choose collection or delivery.' }
  }

  if (method === 'delivery') {
    try {
      const order = await getOrder(id)

      if (!mayBeDelivered(order)) {
        return {
          status: 'refused',
          message:
            'This order contains a controlled medicine and must be collected in person. '
            + 'Controlled items are excluded from delivery and there is no override.',
        }
      }
    } catch (error) {
      return { status: 'refused', message: sentence(error) }
    }
  }

  try {
    const client = await writeClient()
    const response = await client.post<{ data: DispenseOrder }>(
      `/v1/dispense-orders/${id}/fulfilment`,
      { method },
    )

    refresh(paths)

    return { status: 'done', order: response.data }
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }
}

/**
 * The patient collected it at the pharmacy. Terminal.
 *
 * Narrower than it looks: an order set for DELIVERY cannot be collected here. Marking a
 * delivery collected would close it while a rider still holds the package, and the
 * tracking the patient is watching would go quiet with their medicines in transit.
 */
export async function collectOrder(
  paths: readonly string[],
  _previous: BenchState,
  form: FormData,
): Promise<BenchState> {
  const id = String(form.get('order_id') ?? '')

  try {
    const client = await writeClient()
    const response = await client.post<{ data: DispenseOrder }>(
      `/v1/dispense-orders/${id}/collect`,
    )

    refresh(paths)

    return { status: 'done', order: response.data }
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }
}

/**
 * The pharmacy declines to fill the order.
 *
 * A REASON IS REQUIRED. An order that simply stops, with no record of why the pharmacy
 * would not fill it, leaves the prescribing clinician guessing and the patient with
 * nothing to be told.
 *
 * The reason stays on the record and is deliberately kept out of the audit event and every
 * notification — a pharmacist explaining a refusal will naturally name the medicine, and an
 * audit event records that something happened, never what it said. Nothing in this
 * function logs it either.
 */
export async function rejectOrder(
  paths: readonly string[],
  _previous: BenchState,
  form: FormData,
): Promise<BenchState> {
  const id = String(form.get('order_id') ?? '')
  const reason = String(form.get('reason') ?? '').trim()

  if (reason === '') {
    return {
      status: 'refused',
      message: null,
      fields: {
        reason:
          'Say why the pharmacy will not fill this. Without it the prescribing clinician '
          + 'is left guessing and the patient has nothing to be told.',
      },
    }
  }

  try {
    const client = await writeClient()
    const response = await client.post<{ data: DispenseOrder }>(
      `/v1/dispense-orders/${id}/reject`,
      { reason },
    )

    refresh(paths)

    return { status: 'done', order: response.data }
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }
}

/**
 * A pharmacist proposes a substitute. It takes effect only if a clinician approves.
 *
 * THERE IS NO `approve_immediately` FLAG ON THIS REQUEST, and its absence is structural
 * rather than an omission: a substitution takes effect on a clinician's approval or not at
 * all, and the shape of the payload is one of the places that is made true rather than
 * merely checked. A pharmacist cannot approve their own proposal. Neither can an
 * administrator.
 *
 * THE REASON IS MANDATORY. It is the entire basis on which a clinician who is not standing
 * in the pharmacy decides, and "out of stock" is a very different clinical question from
 * "the strength we hold is different".
 */
export async function proposeSubstitution(
  paths: readonly string[],
  _previous: BenchState,
  form: FormData,
): Promise<BenchState> {
  const id = String(form.get('order_id') ?? '')
  const itemId = String(form.get('prescription_item_id') ?? '')
  const proposed = String(form.get('proposed_medicine_name') ?? '').trim()
  const reason = String(form.get('reason') ?? '').trim()

  const fields: Record<string, string> = {}

  if (proposed === '') {
    fields['proposed_medicine_name'] = 'Name the substitute you are proposing.'
  }

  if (reason === '') {
    fields['reason'] =
      'The clinician deciding this is not standing in your pharmacy. "Out of stock" and '
      + '"the strength we hold is different" are different clinical questions.'
  }

  if (Object.keys(fields).length > 0) {
    return { status: 'refused', message: null, fields }
  }

  try {
    const client = await writeClient()
    await client.post(`/v1/dispense-orders/${id}/substitutions`, {
      prescription_item_id: itemId,
      proposed_medicine_name: proposed,
      reason,
    })

    refresh(paths)

    // The order moved to awaiting_substitution and its item list changed, so the caller
    // re-reads rather than being handed the substitution — the screen renders the ORDER.
    return { status: 'done', order: await getOrder(id) }
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }
}

/**
 * The clinician's decision on a proposal.
 *
 * ONLY A CLINICIAN REACHES THIS. `SubstitutionPolicy::decide` admits the clinician role and
 * nothing else — not the pharmacist who proposed it, not the administrator — and deciding
 * twice is an `IllegalTransition`, so an approval cannot later be quietly reversed into a
 * rejection.
 *
 * Approving does not price the item. It unblocks it: the pharmacist prices it afterwards
 * against the approved substitute, which is what carries `substitution_id` onto the
 * dispensed line.
 */
export async function decideSubstitution(
  paths: readonly string[],
  _previous: BenchState,
  form: FormData,
): Promise<BenchState> {
  const orderId = String(form.get('order_id') ?? '')
  const substitutionId = String(form.get('substitution_id') ?? '')
  const decision = String(form.get('decision') ?? '')

  if (decision !== 'approve' && decision !== 'reject') {
    return { status: 'refused', message: 'Approve or decline the proposal.' }
  }

  try {
    const client = await writeClient()
    await client.post(`/v1/substitutions/${substitutionId}/${decision}`)

    refresh(paths)

    return { status: 'done', order: await getOrder(orderId) }
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }
}
