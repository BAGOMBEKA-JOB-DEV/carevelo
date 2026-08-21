'use client'

import { useActionState } from 'react'
import { Badge, Button, Card, Field, Input, Money, Notice } from '@carevelo/ui'
import { IDLE, type BenchState } from '../api/actions'
import { toWholeShillings } from '../model/money'
import type { ItemView } from '../model/order'

/**
 * Pricing the order at the clinic's own prices, and recording what is actually being
 * filled.
 *
 * ------------------------------------------------------------
 * 'use client' BECAUSE OF `useActionState`, AND FOR NOTHING ELSE. The form needs to hold
 * the API's refusal beside the fields the pharmacist already typed — a 422 that cleared the
 * form would mean re-entering a dozen prices, and the twelfth one would be wrong. There is
 * no other client-side behaviour here: no live total, no formatting as you type, no
 * validation that duplicates the server's.
 *
 * ------------------------------------------------------------
 * WHAT THE PHARMACIST TYPES AND WHAT THE API STORES ARE NOT THE SAME NUMBER.
 *
 * Prices are entered in WHOLE SHILLINGS, because that is what a Ugandan price is — UGX has
 * no subunit anybody writes down, and `Money::format()` prints "UGX 150,000" with no
 * decimal point. The API stores minor units, a hundred to the shilling, so
 * `parseWholeShillings` multiplies. There is no decimal input anywhere on this form and a
 * typed decimal point is refused rather than rounded; see model/money.ts for why rounding
 * a price the clinic set is not ours to do.
 *
 * ------------------------------------------------------------
 * EVERY PRESCRIBED ITEM IS ON THE FORM, INCLUDING THE ONES THAT ARE NOT BEING FILLED.
 *
 * The API refuses a payload that leaves an item out: "an item left out is one the patient
 * is never told they did not receive." So an unfulfilled line is a checkbox turned off and
 * a reason typed, not a row deleted. The reason is required, and it is what lets the
 * clinician see later which medicine the patient never got instead of finding a silent gap.
 *
 * ------------------------------------------------------------
 * AN ITEM WITH A PENDING PROPOSAL IS SHOWN, AND IS NOT PRICEABLE.
 *
 * It renders as a locked row rather than disappearing, because a row that vanished would
 * read as an item nobody has to think about. It is omitted from the payload — the API
 * refuses to price a blocked item — and the rest of the order prices normally. That single
 * behaviour is the difference between pharmacists using this system and pricing on paper.
 */
export function PricingForm({
  orderId,
  items,
  deliveryFeeMinor,
  action,
}: {
  orderId: string
  items: readonly ItemView[]
  deliveryFeeMinor: number
  action: (state: BenchState, form: FormData) => Promise<BenchState>
}) {
  const [state, submit, pending] = useActionState(action, IDLE)

  const fields = state.status === 'refused' ? (state.fields ?? {}) : {}
  const priceable = items.filter((item) => !item.pending)

  return (
    <Card as="section" aria-labelledby="pricing">
      <form action={submit} className="grid">
        <input type="hidden" name="order_id" value={orderId} />

        <div className="stack">
          <h2 id="pricing">Price this order</h2>
          <p className="muted">
            The clinic&rsquo;s own prices, in whole shillings, typed by the pharmacy that will
            hand the medicine over. Carevelo records the amount and takes no margin on it.
          </p>
        </div>

        {state.status === 'refused' && state.message ? (
          <Notice tone="bad" title="Not priced">
            {state.message}
          </Notice>
        ) : null}

        {state.status === 'refused' && !state.message && Object.keys(fields).length > 0 ? (
          <Notice tone="bad" title="Not priced">
            Some lines need attention before this can be sent. Nothing has been saved.
          </Notice>
        ) : null}

        {state.status === 'done' ? (
          <Notice tone="info" title="Priced">
            The patient can be told the total. Repricing replaces these lines rather than
            adding to them, so a second pass after a substitution decision is safe.
          </Notice>
        ) : null}

        {items.map((item) => (
          <ItemRow
            key={item.prescribed.id}
            item={item}
            fields={fields}
            disabled={pending}
          />
        ))}

        <Field
          name="delivery_fee"
          label="Delivery fee"
          hint="Whole shillings. Leave blank when the patient is collecting."
          error={fields['delivery_fee']}
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              inputMode="numeric"
              defaultValue={deliveryFeeMinor > 0 ? String(toWholeShillings(deliveryFeeMinor)) : ''}
              disabled={pending}
            />
          )}
        </Field>

        <div className="row-wrap">
          <Button type="submit" variant="primary" disabled={pending || priceable.length === 0}>
            {pending ? 'Saving…' : 'Save prices'}
          </Button>

          {priceable.length === 0 ? (
            <span className="muted">
              Every item is waiting on a clinician&rsquo;s decision, so there is nothing to
              price yet.
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  )
}

/**
 * One prescribed item.
 *
 * The prescribed medicine, dose and directions are shown as text and are never inputs. The
 * prescription is a clinical document and nothing on this bench edits it — what the
 * pharmacist types is what is going in the bag, recorded separately, so both facts survive.
 */
function ItemRow({
  item,
  fields,
  disabled,
}: {
  item: ItemView
  fields: Record<string, string>
  disabled: boolean
}) {
  const id = item.prescribed.id
  const prescribed = item.prescribed

  const strength = [prescribed.form, prescribed.strength].filter(Boolean).join(' ')
  const quantity = [prescribed.quantity, prescribed.unit].filter(Boolean).join(' ')

  return (
    <div className="card card-tight stack">
      <div className="row-wrap">
        <div className="grow stack">
          <strong>{prescribed.medicine_name}</strong>
          <span className="muted">
            {strength === '' ? null : `${strength} · `}
            {quantity} · {prescribed.directions}
          </span>
        </div>

        {prescribed.is_controlled ? (
          <Badge tone="bad" icon="lock">
            Controlled
          </Badge>
        ) : null}
      </div>

      {item.pending ? (
        /*
         * Locked, and visibly so. The proposal is with the prescribing clinician; nothing
         * on this item can move until they decide, and there is no timeout that decides
         * for them. Shown rather than hidden so the pharmacist can see what they are
         * waiting on.
         */
        <Notice tone="warn" title="Waiting on the prescribing clinician">
          You proposed <strong>{item.pending.proposed_medicine_name}</strong> in place of this
          item. It is blocked until the clinician approves or declines — there is no
          auto-approval and no window after which one happens. The rest of the order can be
          priced now.
        </Notice>
      ) : (
        <>
          {item.approved ? (
            <Notice tone="info" title="Substitute approved">
              A clinician approved <strong>{item.approved.proposed_medicine_name}</strong> for
              this item. Enter the substitute below and the dispensed line will carry the
              approval with it.
            </Notice>
          ) : null}

          {item.rejected ? (
            <Notice tone="warn" title="Substitute declined">
              The clinician declined <strong>{item.rejected.proposed_medicine_name}</strong>.
              If there is no alternative, turn this line off and record why — the patient is
              then offered a partial fill rather than finding a gap.
            </Notice>
          ) : null}

          <div className="field">
            <label className="row" htmlFor={`fulfilled_${id}`}>
              <input
                type="checkbox"
                id={`fulfilled_${id}`}
                name={`fulfilled_${id}`}
                defaultChecked={item.dispensed?.is_fulfilled ?? true}
                disabled={disabled}
              />
              <span>Filling this item</span>
            </label>
            <span className="field__hint">
              Turn it off for a partial fill. An unfilled line still goes on the record, with
              a reason.
            </span>
          </div>

          <div className="grid g-3">
            <Field
              name={`name_${id}`}
              label="What is going in the bag"
              hint="May differ from what was prescribed. Both facts are kept."
              error={fields[`name_${id}`]}
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  defaultValue={
                    item.dispensed?.medicine_name_dispensed
                    ?? item.approved?.proposed_medicine_name
                    ?? prescribed.medicine_name
                  }
                  disabled={disabled}
                />
              )}
            </Field>

            <Field
              name={`quantity_${id}`}
              label="Quantity"
              hint={`Prescribed: ${quantity}`}
              error={fields[`quantity_${id}`]}
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode="numeric"
                  defaultValue={String(item.dispensed?.quantity_dispensed ?? prescribed.quantity)}
                  disabled={disabled}
                />
              )}
            </Field>

            <Field
              name={`price_${id}`}
              label="Unit price"
              hint="Whole shillings. No decimal point."
              error={fields[`price_${id}`]}
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode="numeric"
                  defaultValue={
                    item.dispensed
                      ? String(toWholeShillings(item.dispensed.unit_price.amount_minor))
                      : ''
                  }
                  disabled={disabled}
                />
              )}
            </Field>
          </div>

          <Field
            name={`reason_${id}`}
            label="If not filling it, why"
            hint="Required for an unfilled line. The clinician sees this later."
            error={fields[`reason_${id}`]}
          >
            {(control) => (
              <Input
                {...control}
                type="text"
                defaultValue={item.dispensed?.unfulfilled_reason ?? ''}
                disabled={disabled}
              />
            )}
          </Field>

          {item.dispensed ? (
            <p className="muted">
              Currently recorded at <Money value={item.dispensed.unit_price} /> each.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
