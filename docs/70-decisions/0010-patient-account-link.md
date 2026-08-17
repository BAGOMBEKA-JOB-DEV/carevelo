# ADR-0010 — One account, many patient records

> **Status:** Accepted
> **Date:** 2026-08-17
> **Derives from:** [H2 §Registration](../10-product/prd-h2-patient-registration-consent.md), [RBAC Matrix](../50-security-compliance/rbac-matrix.md), Business Plan §130

## Context

There was no link between a `User` and a `Patient`. `users` carried no `patient_id`, neither model referenced the other, and the policies named only staff roles.

The consequence was larger than it looked. Fourteen rows of the [endpoint catalogue](../40-api/endpoint-catalogue.md) are marked `P own` — a patient reading their own appointments, prescriptions, prescription PDF, dispense order, delivery tracking, payment receipt and notifications — and none of them could be implemented, because "the patient of this record" was not a question the schema could answer. `POST /v1/appointments/{id}/join-token` was unbuildable for the same reason: the architecture requires the token be bound to a participant.

It failed shut rather than open, so nothing leaked. But a patient could reach availability and nothing else, and one of the three frontend surfaces in [ADR-0007](0007-separate-backend-frontend-trees.md) is a patient app.

The decision is not *whether* to link, it is the cardinality — and that is hard to reverse once real patient records exist.

## Decision

**`patients.user_id`, nullable, with a composite foreign key on `(tenant_id, user_id)`. One account may own many patient records.**

### Many, not one

A guardian holds their children's records. This is not a hypothetical:

- The catalogue marks patient consents `P, guardian`.
- The business plan requires, under the DPPA's special provisions for minors, that "guardian consent [be] captured".
- `patients` already carries `guardian_name`, `guardian_phone` and `guardian_relationship`.

A parent booking for a child is ordinary in this market. One-to-one would mean a guardian cannot use the patient app for the person they are actually there for, and widening it later means migrating live medical records — the most expensive kind of migration to get wrong.

### Nullable

Most patient records exist before any account does. Front desk registers a walk-in with a phone number and no password; self-registration on the clinic-branded portal is the other path, and H2 permits both. A record with no account is the normal state, not an incomplete one.

### Composite foreign key

`(tenant_id, user_id) → users(tenant_id, id)`, which required a new unique index on `users(tenant_id, id)`.

This matters more here than elsewhere. `users` is **platform-scoped** — it has no row-level security, because authentication has to find the account before a session exists to resolve a tenant from. So for this one reference, RLS is not standing behind the application: the composite key is the only thing that can refuse a patient record naming an account at another clinic. Everywhere else in this schema the composite key is belt-and-braces. Here it is the belt.

### `ON DELETE SET NULL (user_id)`

Declared in raw SQL, because Blueprint cannot express the column list and the difference is not cosmetic. A composite `SET NULL` nulls **every** referencing column, including `tenant_id` — which is `NOT NULL`, and is the column RLS is keyed on. The plain form does not do what it reads as: deleting an account would fail on a not-null violation from a column nobody asked to change.

The column list releases the login and leaves the medical record where it is. The record outlives the account, and the clinic may be legally obliged to retain it.

### Claiming a record

Two paths, both requiring a **verified** phone: self-registration creates the record and links it; an existing record is claimed by matching `patients.phone` against the authenticated user's verified phone, using the existing `users_tenant_id_phone_unique` index. Claiming writes an `AuditEvent`, because it grants a human being sight of a medical record.

`user_id` is deliberately absent from `$fillable`. Linking is an explicit act, not something a request body does on the way past.

## Consequences

**The index path becomes the sharpest edge in the system.** A per-row policy secures `show` and does nothing for `index`. A listing that authorises a patient and then queries unscoped returns every patient in the clinic — and RLS cannot catch it, because all those rows genuinely belong to this tenant. Between two patients of one clinic, authorisation is the entire control.

Mitigated structurally rather than by discipline: `AuthorisesPatientReads::authoriseListing()` authorises and narrows in one call, so there is no way to use it and get one without the other. How each table reaches a patient is stated in the `RestrictableToPatient` interface — checkable by static analysis, and greppable, which matters because the answers genuinely differ.

**Notification ownership is under-inclusive.** A notification records a channel, a number and a body; the notifier is handed an E.164 string, not a patient. Ownership therefore matches on the recipient number. `(tenant_id, phone)` is unique on `patients`, so within a clinic a number resolves to at most one record. A message sent to a `guardian_phone` differing from the record's own phone is not listed — withholding a message the patient could arguably see, which is the right direction for the error to run.

**Accepted cost.** A patient attending two clinics has two accounts and two records, as staff do. That follows from tenant isolation and is not a defect.

## Revisit when

A guardian needs to be distinguished from the patient in the API's own responses — today both simply appear as owned records. Or when a patient legitimately needs cross-clinic visibility, which would be a change to the isolation model and therefore a new ADR, not an amendment to this one.

## Related

[ADR-0002](0002-postgresql-rls-shared-schema-tenancy.md) · [ADR-0007](0007-separate-backend-frontend-trees.md) · [RBAC Matrix](../50-security-compliance/rbac-matrix.md) · [Endpoint Catalogue](../40-api/endpoint-catalogue.md) · [Multi-Tenancy](../30-architecture/multi-tenancy.md)
