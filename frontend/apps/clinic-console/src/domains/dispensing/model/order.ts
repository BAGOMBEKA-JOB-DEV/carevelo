import type {
  DispenseItem,
  DispenseOrder,
  PrescriptionItem,
  Substitution,
  Viewer,
  ViewerAbilities,
} from './types'

/**
 * The facts about an order that the screens keep needing, worked out once.
 *
 * Every function here is derived from what the API returned and nothing else. None of it
 * is an authorisation decision, and none of it is a substitute for one: the API refuses a
 * controlled delivery, refuses a dispense with a pending substitution, and refuses a
 * substitution decision from anyone but a clinician, whatever this file concludes. What
 * this file decides is what the pharmacist is TOLD and which controls are OFFERED — a
 * button that exists only to produce a 422 teaches staff to ignore the screen.
 */

/** A prescribed item, with everything the pharmacy knows about it gathered in one place. */
export type ItemView = {
  prescribed: PrescriptionItem
  /** The pending proposal blocking this item, if there is one. At most one can be pending. */
  pending: Substitution | undefined
  /** An approved substitute this item may be filled with. */
  approved: Substitution | undefined
  /** A rejected proposal, kept visible: the clinician said no and that is part of the record. */
  rejected: Substitution | undefined
  /** What was actually dispensed against this item, once it has been priced. */
  dispensed: DispenseItem | undefined
}

/**
 * Substitution status arrives as a plain `string` on the resource, for the same reason the
 * order's does: the resource emits `$this->status->value` and the generator cannot see the
 * enum through it. `SubstitutionStatus` on the backend has exactly these three cases.
 */
const PENDING = 'pending'
const APPROVED = 'approved'
const REJECTED = 'rejected'

/**
 * The prescription's items, each carrying its proposals and its dispensed line.
 *
 * Driven by the PRESCRIPTION rather than by the dispense items, and that ordering is the
 * point: the prescription is the clinical document and the list of what the patient is
 * owed. Building the list from what was dispensed would make an item nobody priced simply
 * vanish from the screen, which is the exact failure `assertItemsMatchPrescription` exists
 * to prevent on the API — "an item left out is one the patient is never told they did not
 * receive."
 */
export function itemViews(order: DispenseOrder): ItemView[] {
  const prescribed = order.prescription?.items ?? []
  const substitutions = order.substitutions ?? []
  const dispensed = order.items ?? []

  return prescribed.map((item) => {
    const mine = substitutions.filter((s) => s.prescription_item_id === item.id)

    return {
      prescribed: item,
      pending: mine.find((s) => s.status === PENDING),
      approved: mine.find((s) => s.status === APPROVED),
      rejected: mine.find((s) => s.status === REJECTED),
      dispensed: dispensed.find((d) => d.prescription_item_id === item.id),
    }
  })
}

/**
 * Any proposal still waiting on a clinician.
 *
 * `DispenseOrder::dispense()` refuses while one is pending, so this is what turns the
 * dispense control off and puts a sentence in its place. It reads the substitutions the
 * order carried rather than the order's status, because `awaiting_substitution` is a
 * property of the order and "this specific item is blocked" is a property of the item —
 * and the whole design rests on those being different things.
 */
export function pendingSubstitutions(order: DispenseOrder): Substitution[] {
  return (order.substitutions ?? []).filter((s) => s.status === PENDING)
}

/**
 * Whether this order may ever be delivered.
 *
 * CONTROLLED ITEMS ARE EXCLUDED FROM DELIVERY ENTIRELY (NDPA Act Cap 206), and the system
 * offers the clinic no way to override it. `Delivery::createFor()` refuses, and
 * `DispenseOrderController::fulfilment` refuses one step earlier so the patient is told
 * while they are still standing at the counter rather than after they have gone home to
 * wait. This is the third copy of the same refusal and the only one a person reads.
 *
 * NOTE WHAT THIS RETURNS WHEN THE PRESCRIPTION IS NOT LOADED. `false` — collection-only —
 * because the queue listing deliberately does not load the prescription, and the safe
 * direction when we cannot see the items is to assume one of them is controlled. Being
 * wrong that way costs a patient a delivery; being wrong the other way puts a controlled
 * medicine on a motorcycle.
 */
export function mayBeDelivered(order: DispenseOrder): boolean {
  const items = order.prescription?.items

  if (!items) {
    return false
  }

  return !items.some((item) => item.is_controlled)
}

/** The controlled items, for saying WHICH one makes the order collection-only. */
export function controlledItems(order: DispenseOrder): PrescriptionItem[] {
  return (order.prescription?.items ?? []).filter((item) => item.is_controlled)
}

/**
 * What this member of staff may be offered.
 *
 * Straight out of `docs/50-security-compliance/rbac-matrix.md` and the four policies that
 * implement it. The separations are not arbitrary and each one is load-bearing:
 *
 *  - `dispense` is PHARMACIST ONLY. An administrator may run the bench, price and reject,
 *    and may not record that medicine changed hands — "Dispensing is always recorded
 *    against a named pharmacist of the tenant" is acceptance criterion 11.
 *  - `decide` is CLINICIAN ONLY. Not the pharmacist who proposed it, and not the
 *    administrator. A substitution is a clinical decision; auto-approval does not exist.
 *  - `create` on a substitution is pharmacist only, because proposing is a pharmacy act.
 *
 * A clinician holds none of the bench abilities and is not on `viewAny` — they cannot see
 * the queue at all — but `DispenseOrderPolicy::view` admits them to a single order. That
 * is how a clinician reached by a notification lands on one order, decides the
 * substitution, and sees nothing else.
 */
export function abilitiesOf(viewer: Viewer | null): ViewerAbilities {
  const roles = new Set(viewer?.roles ?? [])
  const admin = roles.has('clinic_admin')
  const pharmacist = roles.has('pharmacist')

  return {
    worksTheBench: admin || pharmacist,
    dispenses: pharmacist,
    proposesSubstitutions: pharmacist,
    decidesSubstitutions: roles.has('clinician'),
  }
}
