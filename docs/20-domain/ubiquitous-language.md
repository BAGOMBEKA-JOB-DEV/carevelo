# Ubiquitous Language

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §H; [Glossary](../00-overview/glossary.md)

These are the words the code uses. Class names, table names, API paths, event names and conversation all draw from this list. Where a term was chosen over a more obvious synonym, the reason is given — usually the reason is legal.

The rule: **if a concept is not on this list, it does not exist in the code.** Adding one is a deliberate act, done by editing this document in the same change.

## Naming conventions

| Layer | Convention | Example |
|---|---|---|
| PHP classes | `StudlyCase`, singular | `DispenseOrder` |
| Database tables | `snake_case`, plural | `dispense_orders` |
| Columns | `snake_case` | `dispensed_at` |
| API paths | `kebab-case`, plural | `/v1/dispense-orders` |
| JSON fields | `snake_case` | `dispensed_at` |
| Domain events | past tense | `PrescriptionIssued` |
| Jobs / commands | imperative | `DispatchDelivery` |
| States | `snake_case`, adjectival or past tense | `awaiting_payment`, `dispensed` |

Timestamps end in `_at`, booleans read as assertions (`is_controlled`, `requires_delivery`), and money is stored as an integer minor unit with an explicit currency — never a float. Ugandan shillings have no subunit in practice, but the integer-minor-unit rule holds anyway so the field type never has to change.

## Core terms

### Tenant
One clinic. The unit of isolation, branding, subscription and support.

*Not* "organisation", "practice", "facility" or "account" — those all appear in adjacent conversations with different meanings, and consistency matters more than elegance. Every clinical and commercial row carries `tenant_id`.

### Platform
Carevelo itself, as distinct from any tenant. Platform-scoped data is enumerated explicitly in [Multi-Tenancy](../30-architecture/multi-tenancy.md) and is the *only* data not carrying a `tenant_id`.

### Tenant context
The resolved current tenant for a request or a queued job. Not a domain object — an ambient, request-scoped fact. Its absence is a fatal error, never a default.

### Patient
A person receiving care from one tenant. A person attending two clinics is **two Patient records in two tenants**, deliberately. There is no cross-tenant patient identity in the MVP and adding one would breach isolation.

### Clinician
A registered practitioner engaged by the tenant, holding a `registration_number` and a `registration_body` (UMDPC, AHPC or Nurses & Midwives Council). A Clinician always belongs to a tenant. **There is no platform-level clinician**, because Carevelo never employs clinicians ([Vision & Scope](../00-overview/vision-and-scope.md)).

### Service
A bookable offering with a name, a duration, a price and the clinician roles permitted to deliver it. Prices are per-tenant; there is no platform price list.

### Appointment
A booking: a patient, a service, a clinician, a slot, a mode (in person, video, voice or chat), and a payment expectation.

Distinct from Consultation. An Appointment may be cancelled or no-showed and never become a Consultation. Conflating them loses the ability to measure no-shows, which is a number the clinic owner cares about.

### Consultation
The clinical encounter itself: start and end times, the mode actually used (which may differ from the mode booked — a video call that degrades to voice is common and must be recorded truthfully), notes, and the outcome.

### ClinicalNote
The clinician's record within a Consultation. Append-only in spirit: corrections are made by addendum, never by silent overwrite, because a medical record that can be quietly rewritten is not a medical record.

### Prescription
A clinical document issued **by a Clinician**, bearing their name, registration number and a timestamp, listing prescribed items.

Immutable once issued. Correcting it means cancelling it and issuing a replacement that references the original. The pharmacy never edits it — see DispenseOrder.

Carevelo does not issue prescriptions; it renders and stores what the clinician issued.

### PrescriptionItem
One prescribed medicine: name, form, strength, quantity, directions, and `is_controlled`. Controlled items are flagged for in-person handling and never routed to delivery.

### DispenseOrder
The pharmacy's work item, created from a Prescription. It carries stock checks, pricing, substitutions and the dispensing record.

It exists as a separate aggregate precisely so the Prescription stays immutable. What was *prescribed* and what was *dispensed* are different facts and both must be recoverable.

### Substitution
A proposal by the Pharmacist to dispense a different item from the one prescribed. Requires **clinician re-approval** before it takes effect. It is a first-class, auditable event, not an edit.

### Delivery
The transport of a dispensed order to the patient: address, assigned rider, status thread.

Carries the **minimum necessary data**. A Delivery never contains diagnoses or clinical notes, and this is enforced at the API-serialisation layer rather than in the UI.

### PaymentIntent
Carevelo's *record* of a payment attempt made through the clinic's aggregator.

The name is deliberate. It is not a `Payment` and not a `Transaction`, because Carevelo does not effect payments and holds no funds — it records that an attempt was made and what the aggregator subsequently reported. Anyone reading the class name should be reminded of that. See [Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md).

There is **no `Wallet`, no `Balance`, no `Ledger`, no `Payout` and no `Settlement` entity** anywhere in the platform. Their absence is a compliance control.

### AggregatorAccount
A tenant's own credentials for Flutterwave or Pesapal. Encrypted at rest, write-only through the API, never logged, never returned in any response.

### ConsentRecord
An immutable, timestamped record that a patient granted or withdrew consent, capturing the exact version of the consent text they were shown. Reconstructing what someone agreed to, months later, is the whole point.

### AuditEvent
An append-only record of a security- or privacy-relevant action: who, what, when, which tenant, from where. Never updated. Never deleted. See [Audit Logging](../50-security-compliance/audit-logging.md).

## Domain events

Past tense, and they name business facts rather than database operations. `PrescriptionIssued`, not `PrescriptionCreated`.

| Event | Emitted when |
|---|---|
| `TenantProvisioned` | A clinic tenant is created and isolated |
| `PatientRegistered` | A patient completes registration |
| `ConsentGranted` / `ConsentWithdrawn` | A consent decision is recorded |
| `AppointmentBooked` / `AppointmentCancelled` / `AppointmentNoShowed` | Booking lifecycle |
| `PaymentIntentSucceeded` / `PaymentIntentFailed` | Aggregator reports an outcome |
| `ConsultationStarted` / `ConsultationEnded` | Encounter boundaries |
| `PrescriptionIssued` / `PrescriptionCancelled` | Clinician issues or cancels |
| `SubstitutionProposed` / `SubstitutionApproved` / `SubstitutionRejected` | Substitution lifecycle |
| `OrderDispensed` | Pharmacy hands over or releases for delivery |
| `DeliveryAssigned` / `DeliveryDelivered` / `DeliveryFailed` | Delivery lifecycle |

Every event carries `tenant_id`. A handler that processes an event without restoring tenant context is a bug — see the queue hazard in [Multi-Tenancy](../30-architecture/multi-tenancy.md).

## Words we do not use

| Avoid | Use | Why |
|---|---|---|
| Wallet, Balance, Float, Escrow, Payout, Settlement | *nothing* | These entities must not exist. Non-custodial ([ADR-0003](../70-decisions/0003-non-custodial-payment-architecture.md)) |
| Carevelo doctor, our clinician | Clinician (of a tenant) | We never employ clinicians |
| Our pharmacy, platform stock | The clinic's pharmacy | We never hold drugs |
| Customer | Tenant (the clinic) or Patient | "Customer" is ambiguous between the two and the distinction is legally significant |
| Organisation, Practice, Facility | Tenant | One word for one concept |
| User | The specific role | "User" hides which permissions apply |
| Order | Appointment, DispenseOrder or PaymentIntent | Too vague to be safe |
