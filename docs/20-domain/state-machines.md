# State Machines

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §H3, §H4, §H5

Every stateful entity's legal transitions. Anything not drawn here is illegal and the code must reject it rather than silently permit it.

Two rules apply throughout:

- **Transitions are explicit methods, not attribute assignment.** `$appointment->cancel($reason)` — never `$appointment->status = 'cancelled'`. Illegal transitions throw.
- **Every transition emits a domain event and writes an `AuditEvent`.** State history must be reconstructable from the log alone, because "how did this order get here?" is the most common support question and the hardest to answer after the fact.

## Appointment

```mermaid
stateDiagram-v2
    [*] --> awaiting_payment: booked (prepaid)
    [*] --> confirmed: booked (pay at clinic)

    awaiting_payment --> confirmed: payment succeeded
    awaiting_payment --> confirmed: staff deferral (audited)
    awaiting_payment --> payment_failed: payment failed/timeout
    awaiting_payment --> cancelled: patient cancels
    awaiting_payment --> expired: slot passes unpaid

    payment_failed --> awaiting_payment: retry
    payment_failed --> cancelled: give up

    confirmed --> in_progress: consultation starts
    confirmed --> cancelled: cancelled by either party
    confirmed --> no_show: slot elapsed, nobody joined

    in_progress --> completed: consultation ends
    in_progress --> abandoned: irrecoverable technical failure

    completed --> [*]
    cancelled --> [*]
    no_show --> [*]
    expired --> [*]
    abandoned --> [*]
```

**Notes**

- `expired` and `cancelled` differ: expiry is the system releasing an unpaid slot, cancellation is a human decision. The clinic owner reads these differently and so should we.
- `no_show` triggers the tenant's own refund policy. Carevelo does not decide refund policy — it records the outcome and lets the clinic act through its own aggregator (§H3.6).
- `abandoned` covers a dropped call that could not be resumed. The patient gets a resume link first; only after the window closes does the appointment abandon.
- A cancelled or expired appointment releases the slot immediately.

## Consultation

```mermaid
stateDiagram-v2
    [*] --> in_progress: clinician joins
    in_progress --> in_progress: mode degrades (video → voice → chat)
    in_progress --> ended: clinician ends
    in_progress --> interrupted: connection lost
    interrupted --> in_progress: resumed within window
    interrupted --> ended: window expires, notes retained
    ended --> [*]
```

**Notes**

- Mode degradation is a recorded transition, not a hidden one. `mode_used` reflects reality (see [Domain Model](domain-model.md)).
- **Notes survive interruption.** Drafts are persisted as they are typed; a lost connection must never lose clinical text. This is a hard requirement, not an optimisation — see [Frontend](../30-architecture/frontend-nextjs.md).
- A prescription may be issued only from a consultation that reached `ended` with outcome `completed`.

## Prescription

```mermaid
stateDiagram-v2
    [*] --> issued: clinician issues
    issued --> cancelled: clinician cancels (reason required)
    issued --> superseded: replacement issued
    cancelled --> [*]
    superseded --> [*]
    issued --> [*]: fulfilled
```

**Notes**

- No `draft` state. A prescription exists from the moment it is issued; before that there is only an unsaved form. A half-written prescription is not a clinical document.
- Immutable. Correction is cancel-and-replace with `supersedes_prescription_id`.
- Cancellation after dispensing is still permitted and recorded — it happens, and the record must reflect it rather than refuse it.

## DispenseOrder

```mermaid
stateDiagram-v2
    [*] --> received: prescription routed to pharmacy

    received --> under_review: pharmacist opens
    under_review --> awaiting_substitution: item out of stock
    under_review --> priced: stock confirmed, priced
    under_review --> rejected: cannot fulfil (reason required)

    awaiting_substitution --> priced: substitution approved
    awaiting_substitution --> partially_priced: partial fill accepted
    awaiting_substitution --> rejected: substitution rejected, no alternative

    priced --> awaiting_payment: patient notified of total
    partially_priced --> awaiting_payment

    awaiting_payment --> paid: payment succeeded
    awaiting_payment --> paid: cash at pharmacy (attested)
    awaiting_payment --> cancelled: patient declines / times out

    paid --> dispensed: pharmacist dispenses
    dispensed --> ready_for_pickup: fulfilment = pickup
    dispensed --> out_for_delivery: fulfilment = delivery

    ready_for_pickup --> collected: patient collects
    out_for_delivery --> completed: delivery delivered
    out_for_delivery --> returned: delivery failed

    returned --> out_for_delivery: rescheduled
    returned --> refund_pending: patient gives up

    collected --> [*]
    completed --> [*]
    cancelled --> [*]
    rejected --> [*]
    refund_pending --> [*]
```

**Notes** (all from §H4)

- `awaiting_substitution` blocks only the affected item. The rest of the order proceeds — otherwise one out-of-stock item stalls everything, and pharmacists will work around us rather than with us.
- `partially_priced` is the patient accepting a partial fill.
- **Controlled items never reach `out_for_delivery`.** The order splits or is flagged for in-person collection (NDPA Act Cap 206).
- `refund_pending` is a signal to the clinic to refund through its own aggregator. Carevelo cannot refund; it holds no funds. The state exists to make the obligation visible, not to discharge it.

## Delivery

```mermaid
stateDiagram-v2
    [*] --> unassigned: created
    unassigned --> assigned: dispatcher assigns rider
    assigned --> picked_up: rider collects from pharmacy
    picked_up --> en_route: rider departs
    en_route --> delivered: handed to recipient
    en_route --> failed: recipient unreachable / address wrong / refused
    assigned --> unassigned: rider unassigned
    failed --> returned_to_pharmacy: package returned
    returned_to_pharmacy --> unassigned: rescheduled
    delivered --> [*]
    returned_to_pharmacy --> [*]
```

**Notes**

- Every transition writes a `DeliveryEvent` with actor and timestamp — this is the status thread the patient sees.
- `failed` requires a reason from a fixed list. Free text alone cannot be reported on.
- Package contents are never exposed in the rider-facing view or in any delivery notification.

## PaymentIntent

The one that matters most operationally, because mobile money is genuinely asynchronous — the patient has to pick up their handset and enter a PIN, and they may not (§H5.3).

```mermaid
stateDiagram-v2
    [*] --> initiated: intent created (idempotency key)
    initiated --> pending: aggregator accepted, push sent
    initiated --> failed: aggregator rejected

    pending --> succeeded: webhook or poll confirms
    pending --> failed: explicit failure
    pending --> timed_out: no resolution within window

    timed_out --> pending: reconciliation poll finds late success
    timed_out --> failed: reconciliation confirms failure

    succeeded --> reversed: aggregator reports reversal

    failed --> [*]
    succeeded --> [*]
    reversed --> [*]
```

**Notes**

- `pending` is the normal state, not an edge case. The UI must be honest about waiting rather than pretending to be instant.
- **`timed_out` is not final.** Mobile-money confirmations arrive late; a reconciliation poll can move it to `succeeded`. Treating a timeout as a definitive failure produces the worst possible outcome — a patient charged for a booking that was cancelled.
- Two independent paths resolve a payment: the aggregator **webhook**, and a scheduled **reconciliation poll** as backstop for missed webhooks (§H5.6). Both are idempotent; whichever arrives first wins and the second is a no-op.
- `reversed` is rare, always flagged for the clinic administrator, and never auto-actioned by us.
- No state in this machine represents Carevelo holding money. `succeeded` means *the aggregator told us it settled to the clinic* — nothing more.

## Tenant

```mermaid
stateDiagram-v2
    [*] --> provisioning: signup
    provisioning --> active: onboarding checklist complete
    active --> suspended: non-payment / policy
    suspended --> active: resolved
    active --> offboarding: termination requested
    suspended --> offboarding
    offboarding --> closed: data exported, retention elapsed, deleted
    closed --> [*]
```

**Notes**

- `suspended` blocks staff sign-in. It does **not** block a patient reading their own records, and does not abandon a delivery in flight. A commercial dispute must not become a clinical incident.
- `offboarding` starts the controller-obligation clock: export the clinic's data to the clinic, then delete on the retention schedule ([Retention & Deletion](../50-security-compliance/data-retention-and-deletion.md), §H7.4).
- `closed` means tenant data is deleted; the audit trail of the deletion itself is retained.

## Patient

```mermaid
stateDiagram-v2
    [*] --> pending_consent: registration started
    pending_consent --> active: consent granted + phone verified
    pending_consent --> discarded: consent declined
    active --> withdrawn: consent withdrawn
    withdrawn --> active: consent re-granted
    discarded --> [*]
```

**Notes**

- **No clinical data may attach to a patient in `pending_consent`** (§H2.4).
- `discarded` retains only the minimal contact detail needed to explain why service could not proceed, and is purged on schedule.
- `withdrawn` halts new processing. It does not erase records the clinic must retain as a medical record — the clinic is the controller and that obligation is theirs; see [Retention & Deletion](../50-security-compliance/data-retention-and-deletion.md).
