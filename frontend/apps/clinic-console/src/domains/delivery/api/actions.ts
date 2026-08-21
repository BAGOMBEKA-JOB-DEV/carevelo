'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { sentence, writeClient } from './http'
import type { Delivery, StoreDeliveryRequest } from '../model/types'

/**
 * Creating a delivery, and handing it to a rider.
 *
 * ------------------------------------------------------------
 * TWO REFUSALS LIVE ON THE API AND NEITHER HAS AN OVERRIDE. Nothing in this file tries to
 * pre-empt them, argue with them, or offer a way round them:
 *
 *  1. AN ORDER HOLDING A CONTROLLED ITEM NEVER ENTERS THE DELIVERY FLOW (NDPA Act Cap 206).
 *     `Delivery::createFor()` refuses it, and `DispenseOrderController::fulfilment` refuses
 *     one step earlier so the patient is told at the counter. The screen states the rule
 *     and does not offer the control; the API is what enforces it.
 *  2. AN ADDRESS IS NEVER PREPARED FOR A RIDER WITHOUT THE PATIENT'S `delivery_disclosure`
 *     CONSENT (DPPA 2019), and it is checked AGAIN at assignment — not only at creation —
 *     because that is the instant the address actually reaches a rider, and consent may
 *     have been withdrawn in between.
 *
 * When either refuses, the API's own sentence is what the dispatcher reads. It is better
 * than anything this layer could write, and rephrasing it would put two things in charge of
 * what the rule says.
 *
 * ------------------------------------------------------------
 * NOTHING CLINICAL IS IN ANY PAYLOAD HERE, AND THERE IS NOWHERE TO PUT IT.
 *
 * `StoreDeliveryRequest` carries a name, a telephone number and an address. There is
 * deliberately no field for a medicine, an item list or a note — "a delivery holds no
 * clinical data, so there is nothing for a careless client to send." The body below is
 * typed as that generated request, so a field invented here would not compile.
 */

export type DispatchState =
  | { status: 'idle' }
  | { status: 'done'; delivery: Delivery }
  | { status: 'refused'; message: string | null; fields?: Record<string, string> }

export const IDLE: DispatchState = { status: 'idle' }

function refresh(paths: readonly string[]): void {
  for (const path of paths) {
    revalidatePath(path)
  }
}

/**
 * Dispatch a dispensed order.
 *
 * ------------------------------------------------------------
 * THE RECIPIENT DETAILS ARE TYPED, NOT PREFILLED FROM THE PATIENT RECORD, AND THAT IS A
 * DECISION RATHER THAN A GAP.
 *
 * Two reasons, in order of weight. First, an address on a patient's registration is where
 * they live; a delivery address is where they want a package today, and for a patient at
 * work or staying with family those are different places. Second, this is the moment the
 * address is confirmed with the patient — the same moment their consent to disclose it to a
 * rider has to hold — and a field that arrived prefilled invites nobody to check it.
 *
 * There is also a boundary reason, and it is honest to name it: the patient record belongs
 * to the patients domain, whose public surface in this app is still empty. Reaching around
 * it would be the wrong fix for a screen that should be asking anyway.
 *
 * A UGANDAN ADDRESS IS A SENTENCE AND A LANDMARK, NOT A STREET NUMBER. "Opposite Shell
 * Bugolobi" is how riders actually navigate, which is why `landmark` is a first-class field
 * on the request rather than something appended to the address line.
 */
export async function createDelivery(
  paths: readonly string[],
  /**
   * Where to send the browser afterwards, as a TEMPLATE rather than a function.
   *
   * A bound Server Action argument is serialised into the payload the client holds, and a
   * function is not serialisable — passing `(id) => paths.delivery(id)` here compiles and
   * then fails at runtime, which is the worst combination. So the route layer binds
   * something like `/dispatch/{id}` and this substitutes. `{id}` is the only placeholder
   * and the value substituted into it is one the API just minted, never anything off this
   * form.
   */
  redirectTemplate: string,
  _previous: DispatchState,
  form: FormData,
): Promise<DispatchState> {
  const orderId = String(form.get('dispense_order_id') ?? '')
  const name = String(form.get('recipient_name') ?? '').trim()
  const phone = String(form.get('recipient_phone') ?? '').trim()
  const address = String(form.get('address_text') ?? '').trim()
  const district = String(form.get('district') ?? '').trim()
  const landmark = String(form.get('landmark') ?? '').trim()

  const fields: Record<string, string> = {}

  if (name === '') {
    fields['recipient_name'] = 'Who is receiving it.'
  }

  if (phone === '') {
    fields['recipient_phone'] = 'The number the rider will ring on arrival.'
  }

  if (address === '') {
    fields['address_text'] = 'Where the rider is going, in the words the patient used.'
  }

  if (Object.keys(fields).length > 0) {
    return { status: 'refused', message: null, fields }
  }

  const body: StoreDeliveryRequest = {
    dispense_order_id: orderId,
    recipient_name: name,
    recipient_phone: phone,
    address_text: address,
  }

  /*
   * Assigned only when present, rather than sent as an empty string. `district` and
   * `landmark` are nullable on the request, and an empty string is a value — it would be
   * stored, and then printed on a rider's screen as a blank line where a landmark should be.
   */
  if (district !== '') {
    body.district = district
  }

  if (landmark !== '') {
    body.landmark = landmark
  }

  let created: Delivery

  try {
    const client = await writeClient()
    const response = await client.post<{ data: Delivery }>('/v1/deliveries', body)

    created = response.data
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }

  refresh(paths)

  /*
   * `redirect()` throws to unwind the render, so it is outside the try — inside, it would
   * be caught and reported as a failed request on a delivery that was in fact created, and
   * a dispatcher would create a second one.
   *
   * The destination is a template bound by the route layer at render time, never a value
   * read from this form. A redirect target a request can supply is a redirect an attacker
   * writes.
   */
  redirect(redirectTemplate.replace('{id}', encodeURIComponent(created.id)))
}

/**
 * Hand the delivery to a named rider.
 *
 * ------------------------------------------------------------
 * REASSIGNMENT IS LEGITIMATE AND EXPECTED, WHICH IS WHY THIS IS THE SAME ACTION.
 *
 * A rider goes unreachable mid-delivery; a failed delivery goes out again after returning
 * to the pharmacy. The API stands the delivery down before reassigning, so THE ORIGINAL
 * ASSIGNMENT IS KEPT IN THE EVENT HISTORY rather than overwritten — which is what makes
 * "who had this package on Tuesday" answerable.
 *
 * ONE RIDER, ONE DELIVERY. There is no multi-select here and no batch assign, because the
 * rider's own surface is scoped to their own assignments and a batch would only be a way of
 * doing the wrong thing faster.
 *
 * CONSENT IS RE-CHECKED BY THE API AT THIS EXACT MOMENT. This is the instant the address
 * reaches a rider, and consent may have been withdrawn since the delivery was created. If
 * it has, the assignment is refused and the dispatcher reads why.
 */
export async function assignRider(
  paths: readonly string[],
  _previous: DispatchState,
  form: FormData,
): Promise<DispatchState> {
  const deliveryId = String(form.get('delivery_id') ?? '')
  const riderId = String(form.get('rider_id') ?? '').trim()

  if (riderId === '') {
    return {
      status: 'refused',
      message: null,
      fields: { rider_id: 'Choose the rider who is carrying this.' },
    }
  }

  try {
    const client = await writeClient()
    const response = await client.post<{ data: Delivery }>(
      `/v1/deliveries/${deliveryId}/assign`,
      { rider_id: riderId },
    )

    refresh(paths)

    return { status: 'done', delivery: response.data }
  } catch (error) {
    return { status: 'refused', message: sentence(error) }
  }
}
