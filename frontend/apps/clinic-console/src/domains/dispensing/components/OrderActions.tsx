'use client'

import { useActionState } from 'react'
import { Button, Card, Field, Notice, Textarea } from '@carevelo/ui'
import { IDLE, type BenchState } from '../api/actions'

/**
 * The bench controls: open, dispense, hand over, decline.
 *
 * ------------------------------------------------------------
 * WHAT IS OFFERED IS DECIDED HERE. WHAT IS PERMITTED IS DECIDED ON THE API. Every control
 * below is gated twice — by the state machine and by a policy — and this component's
 * gating changes neither. Hiding a control that would be refused is a courtesy to the
 * pharmacist, not a security measure, and it is worth doing for one reason: a bench full
 * of buttons that produce 409s teaches staff that the screen is lying to them, and then
 * they stop reading the sentences that matter.
 *
 * ------------------------------------------------------------
 * DISPENSE IS PHARMACIST-ONLY, AND NOT BECAUSE OF A CONFIGURATION.
 *
 * `DispenseOrderPolicy::dispense` admits the pharmacist role and nothing else — an
 * administrator may run the whole bench, price an order and decline it, and may not record
 * that medicine changed hands. "Dispensing is always recorded against a named pharmacist
 * of the tenant" is acceptance criterion 11 and the NDPA Act Cap 206 is the reason. The
 * pharmacist's identity comes from the session and never from this form, so there is no
 * field here to fill in on somebody else's behalf.
 */

export function OrderActions({
  orderId,
  status,
  fulfilment,
  mayWorkTheBench,
  mayDispense,
  mayBeDelivered,
  blockingSubstitutions,
  open,
  dispense,
  chooseFulfilment,
  collect,
  reject,
}: {
  orderId: string
  status: string
  fulfilment: string | null
  mayWorkTheBench: boolean
  mayDispense: boolean
  mayBeDelivered: boolean
  blockingSubstitutions: number
  open: (state: BenchState, form: FormData) => Promise<BenchState>
  dispense: (state: BenchState, form: FormData) => Promise<BenchState>
  chooseFulfilment: (state: BenchState, form: FormData) => Promise<BenchState>
  collect: (state: BenchState, form: FormData) => Promise<BenchState>
  reject: (state: BenchState, form: FormData) => Promise<BenchState>
}) {
  if (!mayWorkTheBench && !mayDispense) {
    return null
  }

  return (
    <Card as="section" aria-labelledby="bench">
      <div className="grid">
        <h2 id="bench">At the bench</h2>

        {status === 'received' ? (
          <SimpleAction
            orderId={orderId}
            action={open}
            label="Take this to the bench"
            variant="primary"
            explanation={
              'Moves the order to under review so nobody else picks it up. Two pharmacists '
              + 'reaching for the same order is a real event; the second one is told rather '
              + 'than silently duplicating the work.'
            }
          />
        ) : null}

        {mayDispense && (status === 'paid' || status === 'priced' || status === 'partially_priced') ? (
          blockingSubstitutions > 0 ? (
            <Notice tone="warn" title="Dispensing is refused while a substitution is pending">
              {blockingSubstitutions === 1
                ? 'One proposal on this order is still with the prescribing clinician.'
                : `${blockingSubstitutions} proposals on this order are still with the prescribing clinician.`}{' '}
              An unapproved substitute must not leave the pharmacy, so the control is not
              offered until every proposal has been decided. The rest of the order can be
              priced meanwhile.
            </Notice>
          ) : (
            <SimpleAction
              orderId={orderId}
              action={dispense}
              label="Dispense"
              variant="primary"
              explanation={
                'Records that the medicine was handed over, against your name. There is no '
                + 'field for whose name — it is taken from your session, because attribution '
                + 'is the whole point of the record.'
              }
            />
          )
        ) : null}

        {status === 'dispensed' || status === 'priced' || status === 'partially_priced' ? (
          <FulfilmentChoice
            orderId={orderId}
            current={fulfilment}
            mayBeDelivered={mayBeDelivered}
            action={chooseFulfilment}
          />
        ) : null}

        {mayDispense && (status === 'ready_for_pickup' || status === 'dispensed')
          && fulfilment !== 'delivery' ? (
          <SimpleAction
            orderId={orderId}
            action={collect}
            label="The patient collected it"
            variant="primary"
            explanation={
              'Terminal. An order set for delivery cannot be closed here — marking a delivery '
              + 'collected would close it while a rider still holds the package, and the '
              + 'patient would be watching tracking that had gone quiet.'
            }
          />
        ) : null}

        {mayWorkTheBench && !TERMINAL.has(status) ? (
          <RejectForm orderId={orderId} action={reject} />
        ) : null}
      </div>
    </Card>
  )
}

/**
 * States from which nothing further is offered.
 *
 * A plain `Set<string>` rather than a typed union, because `DispenseOrderResource.status`
 * arrives as a `string` — the resource emits the enum's value and the generator cannot see
 * through it. Anything unrecognised falls through to "not terminal", which errs toward
 * showing a control that the API will refuse rather than hiding one that would have worked.
 */
const TERMINAL = new Set([
  'collected',
  'completed',
  'cancelled',
  'rejected',
  'returned',
  'refund_pending',
])

/** A one-button action with a sentence saying what pressing it does. */
function SimpleAction({
  orderId,
  action,
  label,
  variant,
  explanation,
}: {
  orderId: string
  action: (state: BenchState, form: FormData) => Promise<BenchState>
  label: string
  variant: 'primary' | 'quiet'
  explanation: string
}) {
  const [state, submit, busy] = useActionState(action, IDLE)

  return (
    <form action={submit} className="stack">
      <input type="hidden" name="order_id" value={orderId} />

      {state.status === 'refused' ? (
        <Notice tone="bad" title="That did not go through">
          {state.message
            ?? 'The console could not reach the API. Nothing has changed; try again.'}
        </Notice>
      ) : null}

      <div>
        <Button type="submit" variant={variant} disabled={busy}>
          {busy ? 'Working…' : label}
        </Button>
      </div>

      <p className="muted">{explanation}</p>
    </form>
  )
}

/**
 * Pickup or delivery.
 *
 * ------------------------------------------------------------
 * CONTROLLED ITEMS MAY NOT BE DELIVERED, AND THERE IS NO OVERRIDE ANYWHERE ON THIS SCREEN.
 *
 * Not a disabled toggle with an "are you sure", not a permission an administrator can
 * grant. The delivery option is simply absent, and a sentence says why. NDPA Act Cap 206
 * excludes controlled items from the delivery flow entirely; the API refuses at this
 * endpoint and again at `Delivery::createFor()`, and the PRD is explicit that "the system
 * does not offer the clinic a way to override this."
 *
 * The order then either splits — controlled items collected in person, the rest delivered
 * as a separate order — or is marked collection-only. Splitting is a clinical and
 * operational decision the pharmacy makes with the patient at the counter, so this screen
 * states the constraint and leaves the choice to them rather than automating a split
 * nobody asked for.
 *
 * DELIVERY ALSO NEEDS THE PATIENT'S `delivery_disclosure` CONSENT TO ALREADY EXIST, and
 * this form does not capture it. Capturing consent needs the exact policy text the patient
 * read and the hash taken over it, and one writer owns both. When it is missing, the API
 * says so and that sentence appears here.
 */
function FulfilmentChoice({
  orderId,
  current,
  mayBeDelivered,
  action,
}: {
  orderId: string
  current: string | null
  mayBeDelivered: boolean
  action: (state: BenchState, form: FormData) => Promise<BenchState>
}) {
  const [state, submit, busy] = useActionState(action, IDLE)

  return (
    <form action={submit} className="stack">
      <input type="hidden" name="order_id" value={orderId} />

      <h3>How is the patient getting this?</h3>

      {current ? (
        <p className="muted">
          Currently recorded as {current === 'delivery' ? 'delivery' : 'collection'}.
        </p>
      ) : null}

      {state.status === 'refused' ? (
        <Notice tone="bad" title="Not recorded">
          {state.message
            ?? 'The console could not reach the API. Nothing has changed; try again.'}
        </Notice>
      ) : null}

      {!mayBeDelivered ? (
        <Notice tone="warn" title="Collection only — this order holds a controlled medicine">
          Controlled items are excluded from delivery entirely under the NDPA Act Cap 206 and
          there is no override. Either hand the controlled items over in person and dispatch
          the rest as a separate order, or tell the patient this one is collection-only.
        </Notice>
      ) : null}

      <div className="row-wrap">
        <Button type="submit" name="method" value="pickup" variant="quiet" disabled={busy}>
          Collecting at the pharmacy
        </Button>

        {mayBeDelivered ? (
          <Button type="submit" name="method" value="delivery" variant="quiet" disabled={busy}>
            Having it delivered
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/**
 * The pharmacy declines to fill the order.
 *
 * A REASON IS REQUIRED, and it is required by the API rather than only by this form. An
 * order that simply stops, with no record of why the pharmacy would not fill it, leaves the
 * prescribing clinician guessing and the patient with nothing to be told.
 *
 * The hint says the reason stays on the record, because it does and because a pharmacist
 * should know before typing: it is deliberately kept out of the audit event and out of every
 * notification, since explaining a refusal naturally names the medicine.
 */
function RejectForm({
  orderId,
  action,
}: {
  orderId: string
  action: (state: BenchState, form: FormData) => Promise<BenchState>
}) {
  const [state, submit, busy] = useActionState(action, IDLE)
  const fields = state.status === 'refused' ? (state.fields ?? {}) : {}

  return (
    <form action={submit} className="stack">
      <input type="hidden" name="order_id" value={orderId} />

      <h3>Decline this order</h3>

      {state.status === 'refused' && state.message ? (
        <Notice tone="bad" title="Not declined">
          {state.message}
        </Notice>
      ) : null}

      <Field
        name="reason"
        label="Why the pharmacy will not fill this"
        hint="Kept on the order for the prescribing clinician. It is never copied into the audit trail or a notification."
        error={fields['reason']}
      >
        {(control) => <Textarea {...control} rows={2} disabled={busy} />}
      </Field>

      <div>
        <Button type="submit" variant="danger" disabled={busy}>
          {busy ? 'Working…' : 'Decline the order'}
        </Button>
      </div>
    </form>
  )
}
