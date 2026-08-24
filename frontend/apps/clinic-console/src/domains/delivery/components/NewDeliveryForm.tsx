'use client'

import { useActionState } from 'react'
import { Button, Card, Field, Input, Notice, Textarea } from '@carevelo/ui'
import { IDLE, type DispatchState } from '../model/state'

/**
 * Creating the delivery record for a dispensed order.
 *
 * ------------------------------------------------------------
 * EVERY FIELD ON THIS FORM IS SOMETHING A COURIER NEEDS TO FIND A DOOR. There is no field
 * for a medicine, an item list or a note, and there is nowhere to add one: the request type
 * is generated from the contract, and `StoreDeliveryRequest` has no such property. "A
 * delivery holds no clinical data, so there is nothing for a careless client to send."
 *
 * ------------------------------------------------------------
 * WHY THE ADDRESS IS TYPED RATHER THAN PULLED FROM THE PATIENT RECORD.
 *
 * An address on a registration is where somebody lives. A delivery address is where they
 * want a package today — and for a patient at work, or staying with family, those are
 * different places. More to the point, this is the moment the address is confirmed WITH the
 * patient, which is the same moment their consent to disclose it to a rider has to hold. A
 * field that arrived prefilled invites nobody to check it.
 *
 * ------------------------------------------------------------
 * A UGANDAN ADDRESS IS A SENTENCE AND A LANDMARK, NOT A STREET NUMBER.
 *
 * "Opposite Shell Bugolobi" is how riders actually navigate. `landmark` is a first-class
 * field on the request for that reason rather than something appended to the address line,
 * and the form treats it as one — it gets its own label and its own hint, not a placeholder
 * inside another box.
 */
export function NewDeliveryForm({
  orderId,
  orderReference,
  deliverable,
  action,
}: {
  orderId: string
  orderReference: string
  /**
   * Whether the order may be delivered at all. Computed by the DISPENSING domain from the
   * prescription's `is_controlled` flags — one implementation of the controlled-substance
   * rule rather than two that can disagree.
   */
  deliverable: boolean
  action: (state: DispatchState, form: FormData) => Promise<DispatchState>
}) {
  const [state, submit, busy] = useActionState(action, IDLE)
  const fields = state.status === 'refused' ? (state.fields ?? {}) : {}

  if (!deliverable) {
    /*
     * NO FORM AT ALL, NOT A DISABLED ONE. Controlled items are excluded from the delivery
     * flow entirely under the NDPA Act Cap 206 and the system offers the clinic no way to
     * override it. A greyed-out form with an explanation still reads as a permission
     * somebody could be granted; an absent one does not.
     */
    return (
      <Card as="section" aria-labelledby="new-delivery">
        <div className="stack">
          <h2 id="new-delivery">This order cannot be delivered</h2>

          <Notice tone="bad" title="It holds a controlled medicine">
            Controlled items are excluded from delivery entirely under the NDPA Act Cap 206,
            and there is no override — not a setting, not a permission, not an administrator
            approval. The patient collects in person. If only some items are controlled, the
            pharmacy hands those over at the counter and dispatches the remainder as a
            separate order.
          </Notice>
        </div>
      </Card>
    )
  }

  return (
    <Card as="section" aria-labelledby="new-delivery">
      <form action={submit} className="grid">
        <input type="hidden" name="dispense_order_id" value={orderId} />

        <div className="stack">
          <h2 id="new-delivery">Dispatch {orderReference}</h2>
          <p className="muted">
            Confirm these with the patient. Nothing here describes what is in the package,
            and nothing a rider sees ever will.
          </p>
        </div>

        {state.status === 'refused' && state.message ? (
          <Notice tone="bad" title="Not created">
            {/*
             * Verbatim from the API. The two refusals that land here are the ones worth
             * reading exactly as written: the order is not in a state that can leave the
             * pharmacy, or the patient's delivery consent does not exist.
             */}
            {state.message}
          </Notice>
        ) : null}

        <Field
          name="recipient_name"
          label="Who is receiving it"
          hint="The name the rider will ask for. Not necessarily the patient."
          error={fields['recipient_name']}
        >
          {(control) => <Input {...control} type="text" required disabled={busy} />}
        </Field>

        <Field
          name="recipient_phone"
          label="Their telephone number"
          hint="The rider rings this on arrival."
          error={fields['recipient_phone']}
        >
          {(control) => <Input {...control} type="tel" required disabled={busy} />}
        </Field>

        <Field
          name="address_text"
          label="Where to"
          hint="In the words the patient used. A sentence, not a street number."
          error={fields['address_text']}
        >
          {(control) => <Textarea {...control} required rows={2} disabled={busy} />}
        </Field>

        <div className="grid g-2">
          <Field name="district" label="District" hint="Optional.">
            {(control) => <Input {...control} type="text" disabled={busy} />}
          </Field>

          <Field
            name="landmark"
            label="Landmark"
            hint="Optional, and the field riders actually use. “Opposite Shell Bugolobi”."
          >
            {(control) => <Input {...control} type="text" disabled={busy} />}
          </Field>
        </div>

        <Notice tone="info" title="What the rider will be able to see">
          Exactly the five things above, plus the package reference and the status controls.
          No diagnosis, no clinical note, no prescription detail — that is enforced in the
          API&rsquo;s resource layer and covered by a test, not left to this screen to remember.
        </Notice>

        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create the delivery'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
