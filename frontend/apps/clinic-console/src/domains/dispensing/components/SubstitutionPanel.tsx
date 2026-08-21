'use client'

import { useActionState } from 'react'
import { Button, Card, DateTime, Field, Input, Notice, Select, Textarea } from '@carevelo/ui'
import { IDLE, type BenchState } from '../api/actions'
import type { ItemView } from '../model/order'

/**
 * Proposing a substitute, and deciding on one.
 *
 * ------------------------------------------------------------
 * THE SEPARATION IS THE ENTIRE POINT, AND IT IS WHY THESE ARE TWO FORMS RATHER THAN ONE
 * PANEL WITH A ROLE CHECK IN THE MIDDLE.
 *
 * A pharmacist PROPOSES. A clinician DECIDES. They are different policy methods held by
 * different roles: the pharmacist who proposed cannot approve their own proposal, and
 * neither can the administrator. There is no auto-approval and no timeout that grants one —
 * a clinician who cannot be reached leaves the order holding, and the patient is offered a
 * partial fill or a wait. That is a worse experience and the only defensible behaviour.
 *
 * A SUBSTITUTION IS NEVER AN EDIT TO THE PRESCRIPTION. Nothing in this file writes to a
 * prescription, and nothing anywhere else does either. The proposal, the decision and the
 * eventual dispensed line all live on the dispense order, so what was prescribed and what
 * was handed over remain two separate, surviving facts.
 *
 * ------------------------------------------------------------
 * WHY THE APPROVE CONTROLS ARE HERE AT ALL, ON A SCREEN A CLINICIAN CANNOT REACH FROM THE
 * NAV.
 *
 * `DispenseOrderPolicy::viewAny` excludes clinicians, so a clinician never sees the queue.
 * `DispenseOrderPolicy::view` admits them to a SINGLE order. That is deliberate and it is
 * how the flow works: the clinician is notified on their own channel, follows the link to
 * one order, decides, and sees nothing else in the pharmacy. So this panel renders its
 * decision controls for a clinician and its proposal form for a pharmacist, and shows
 * neither to somebody holding neither role.
 */

export function SubstitutionPanel({
  orderId,
  items,
  mayPropose,
  mayDecide,
  propose,
  decide,
}: {
  orderId: string
  items: readonly ItemView[]
  mayPropose: boolean
  mayDecide: boolean
  propose: (state: BenchState, form: FormData) => Promise<BenchState>
  decide: (state: BenchState, form: FormData) => Promise<BenchState>
}) {
  const pending = items.filter((item) => item.pending)
  const decided = items.filter((item) => item.approved ?? item.rejected)

  // Nothing to show and nothing this viewer may do. Rendering an empty card would be
  // furniture on a screen a pharmacist reads under time pressure.
  if (!mayPropose && !mayDecide && pending.length === 0 && decided.length === 0) {
    return null
  }

  return (
    <Card as="section" aria-labelledby="substitutions">
      <div className="grid">
        <div className="stack">
          <h2 id="substitutions">Substitutions</h2>
          <p className="muted">
            A pharmacist proposes; the prescribing clinician decides. A pending proposal
            blocks its own item and nothing else, and dispensing is refused while any
            proposal on this order is still undecided.
          </p>
        </div>

        {pending.map((item) => (
          <PendingProposal
            key={item.prescribed.id}
            orderId={orderId}
            item={item}
            mayDecide={mayDecide}
            decide={decide}
          />
        ))}

        {decided.map((item) => {
          const substitution = item.approved ?? item.rejected

          if (!substitution) {
            return null
          }

          return (
            <Notice
              key={item.prescribed.id}
              tone={item.approved ? 'info' : 'warn'}
              title={item.approved ? 'Approved' : 'Declined'}
            >
              <strong>{substitution.proposed_medicine_name}</strong> in place of{' '}
              <strong>{item.prescribed.medicine_name}</strong>. Reason given:{' '}
              {substitution.reason}
              {substitution.decided_at ? (
                <>
                  {' '}
                  Decided <DateTime value={substitution.decided_at} format="datetime" />.
                </>
              ) : null}
            </Notice>
          )
        })}

        {mayPropose ? (
          <ProposeForm orderId={orderId} items={items} propose={propose} />
        ) : null}
      </div>
    </Card>
  )
}

/** One proposal waiting on a decision, with the two buttons only a clinician is shown. */
function PendingProposal({
  orderId,
  item,
  mayDecide,
  decide,
}: {
  orderId: string
  item: ItemView
  mayDecide: boolean
  decide: (state: BenchState, form: FormData) => Promise<BenchState>
}) {
  const [state, submit, busy] = useActionState(decide, IDLE)
  const proposal = item.pending

  if (!proposal) {
    return null
  }

  return (
    <div className="card card-tight stack">
      <strong>
        {proposal.proposed_medicine_name} in place of {item.prescribed.medicine_name}
      </strong>

      <p className="muted">
        {/* The reason IS the substance of the proposal. A clinician deciding this is not
            standing in the pharmacy, and "out of stock" is a different clinical question
            from "the strength we hold is different". */}
        Reason given: {proposal.reason}
        {proposal.proposed_at ? (
          <>
            {' '}
            Proposed <DateTime value={proposal.proposed_at} format="datetime" />.
          </>
        ) : null}
      </p>

      {state.status === 'refused' ? (
        <Notice tone="bad" title="Not decided">
          {state.message
            ?? 'The console could not reach the API. Nothing has changed; try again.'}
        </Notice>
      ) : null}

      {mayDecide ? (
        <form action={submit} className="row-wrap">
          <input type="hidden" name="order_id" value={orderId} />
          <input type="hidden" name="substitution_id" value={proposal.id} />

          <Button type="submit" name="decision" value="approve" variant="primary" disabled={busy}>
            Approve the substitute
          </Button>

          <Button type="submit" name="decision" value="reject" variant="danger" disabled={busy}>
            Decline
          </Button>
        </form>
      ) : (
        <p className="muted">
          Only the prescribing clinician can decide this. Not the pharmacist who proposed
          it, and not the administrator — a substitution is a clinical decision, and there is
          no setting that changes that.
        </p>
      )}
    </div>
  )
}

/** The pharmacist's proposal form. */
function ProposeForm({
  orderId,
  items,
  propose,
}: {
  orderId: string
  items: readonly ItemView[]
  propose: (state: BenchState, form: FormData) => Promise<BenchState>
}) {
  const [state, submit, busy] = useActionState(propose, IDLE)
  const fields = state.status === 'refused' ? (state.fields ?? {}) : {}

  /*
   * An item that already has a proposal, approved or pending, is not offered again. The
   * state machine allows only one live proposal per item, and offering a control that can
   * only produce a 409 teaches staff to ignore what the screen says.
   */
  const available = items.filter((item) => !item.pending && !item.approved)

  if (available.length === 0) {
    return (
      <Notice tone="info" title="Nothing left to propose">
        Every item on this order has either been decided or has a proposal waiting.
      </Notice>
    )
  }

  return (
    <form action={submit} className="grid">
      <input type="hidden" name="order_id" value={orderId} />

      <h3>Propose a substitute</h3>

      {state.status === 'refused' && state.message ? (
        <Notice tone="bad" title="Not proposed">
          {state.message}
        </Notice>
      ) : null}

      {state.status === 'done' ? (
        <Notice tone="info" title="Sent to the prescribing clinician">
          That item is now blocked until they decide. The rest of the order can still be
          priced and, once decided, dispensed.
        </Notice>
      ) : null}

      <Field name="prescription_item_id" label="Which prescribed item">
        {(control) => (
          <Select {...control} required disabled={busy}>
            {available.map((item) => (
              <option key={item.prescribed.id} value={item.prescribed.id}>
                {item.prescribed.medicine_name}
                {item.prescribed.strength ? ` ${item.prescribed.strength}` : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        name="proposed_medicine_name"
        label="Substitute you are proposing"
        error={fields['proposed_medicine_name']}
      >
        {(control) => <Input {...control} type="text" required disabled={busy} />}
      </Field>

      <Field
        name="reason"
        label="Why"
        hint="The clinician deciding this is not in your pharmacy. Give them what they need."
        error={fields['reason']}
      >
        {(control) => <Textarea {...control} required disabled={busy} rows={3} />}
      </Field>

      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send for approval'}
        </Button>
      </div>
    </form>
  )
}
