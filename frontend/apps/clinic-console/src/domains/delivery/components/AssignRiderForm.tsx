'use client'

import { useActionState } from 'react'
import { Button, Card, Field, Input, Notice, Select } from '@carevelo/ui'
import { IDLE, type DispatchState } from '../api/actions'
import type { Staff } from '../model/types'

/**
 * Handing a delivery to a rider, or taking it off one and giving it to another.
 *
 * ------------------------------------------------------------
 * THE PICKER DEGRADES INTO A TEXT FIELD, AND THAT IS THE INTERESTING PART OF THIS FILE.
 *
 * `GET /v1/tenant/users` is administrator-only — `StaffController::administeredTenant()`
 * throws unless the caller holds `clinic_admin`. Assigning a rider is open to the
 * administrator AND the dispatcher. So the person who does this job all day is exactly the
 * person who cannot fetch the list of names.
 *
 * The wrong fix is to widen an administrative endpoint so a dropdown can be populated. The
 * right one is what this does: `riders === null` means "you may not list staff", and the
 * field becomes an identifier the dispatcher types. `AssignRiderRequest` then validates it
 * against "an active rider of this clinic", and answers "no such user", "user of another
 * clinic" and "not a rider" with ONE message on purpose — a distinguishable response would
 * turn this field into a directory of other clinics' staff.
 *
 * `null` is therefore not the same as an empty array. An empty array means this clinic has
 * no active riders and somebody should invite one; `null` means the list is not yours to
 * see. They look identical in an empty dropdown and mean completely different things.
 *
 * ------------------------------------------------------------
 * REASSIGNMENT USES THE SAME FORM, DELIBERATELY.
 *
 * A rider goes unreachable mid-delivery; a failed delivery goes out again after returning
 * to the pharmacy. The API stands the delivery down before reassigning, so the original
 * assignment stays in the event history rather than being overwritten — which is what makes
 * "who had this package on Tuesday" a question with an answer.
 */
export function AssignRiderForm({
  deliveryId,
  currentRiderId,
  riders,
  mayAssign,
  action,
}: {
  deliveryId: string
  currentRiderId: string | null
  /** `null` means this viewer may not list staff. See above — not the same as empty. */
  riders: Staff[] | null
  mayAssign: boolean
  action: (state: DispatchState, form: FormData) => Promise<DispatchState>
}) {
  const [state, submit, busy] = useActionState(action, IDLE)
  const fields = state.status === 'refused' ? (state.fields ?? {}) : {}

  if (!mayAssign) {
    return (
      <Card as="section" aria-labelledby="assign">
        <div className="stack">
          <h2 id="assign">Rider</h2>
          <p className="muted">
            Only the clinic administrator and the dispatchers assign riders. A rider does not
            assign work — to themselves or to anybody else.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card as="section" aria-labelledby="assign">
      <form action={submit} className="grid">
        <input type="hidden" name="delivery_id" value={deliveryId} />

        <div className="stack">
          <h2 id="assign">{currentRiderId ? 'Reassign this delivery' : 'Assign a rider'}</h2>
          <p className="muted">
            One rider, one delivery. What crosses to them is the recipient, their telephone
            number, the address with any landmark, and the package reference — nothing about
            what is in it.
          </p>
        </div>

        {state.status === 'refused' && state.message ? (
          <Notice tone="bad" title="Not assigned">
            {/*
             * The API's own sentence, unchanged. Two of the refusals it can give here are
             * the ones that matter most — the patient's delivery consent has been withdrawn,
             * or the chosen person is not an active rider of this clinic — and rephrasing
             * either would put two things in charge of what the rule says.
             */}
            {state.message}
          </Notice>
        ) : null}

        {state.status === 'done' ? (
          <Notice tone="info" title="Assigned">
            The rider can now see the recipient and the address on their own surface. The
            previous assignment, if there was one, stays in this delivery&rsquo;s history.
          </Notice>
        ) : null}

        {riders === null ? (
          <Field
            name="rider_id"
            label="Rider identifier"
            hint={
              'The clinic’s staff list is administrator-only, so there is no picker here. '
              + 'The identifier is checked against the active riders of this clinic.'
            }
            error={fields['rider_id']}
          >
            {(control) => (
              <Input {...control} type="text" required disabled={busy} autoComplete="off" />
            )}
          </Field>
        ) : riders.length === 0 ? (
          <Notice tone="warn" title="This clinic has no active riders">
            Somebody has to be invited in the rider role before a delivery can go out. Until
            then the order holds at dispensed and the patient should be offered collection.
          </Notice>
        ) : (
          <Field name="rider_id" label="Rider" error={fields['rider_id']}>
            {(control) => (
              <Select
                {...control}
                required
                disabled={busy}
                defaultValue={currentRiderId ?? ''}
              >
                <option value="">Choose a rider</option>
                {riders.map((rider) => (
                  <option key={rider.id} value={rider.id}>
                    {rider.name}
                    {rider.phone ? ` — ${rider.phone}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {riders !== null && riders.length === 0 ? null : (
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Assigning…' : currentRiderId ? 'Reassign' : 'Assign'}
            </Button>
          </div>
        )}
      </form>
    </Card>
  )
}
