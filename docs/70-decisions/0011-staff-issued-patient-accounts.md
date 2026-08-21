# ADR-0011 — Email and password for patients; accounts issued by clinic staff

> **Status:** Accepted
> **Date:** 2026-08-17
> **Amends:** [ADR-0010](0010-patient-account-link.md) — § *Claiming a record* only; the cardinality decision and everything resting on it stand
> **Derives from:** [H2 §Registration](../10-product/prd-h2-patient-registration-consent.md), [Authentication & Sessions](../40-api/authentication-and-sessions.md), [Threat Model](../50-security-compliance/threat-model.md)

## Context

A patient signed in with a six-digit code sent by SMS. `POST /v1/auth/otp/request` and `POST /v1/auth/otp/verify`, a one-time-code table, an SMS template forbidden from carrying anything but the bare code, and a `dev:otp` command to read one locally. No password at all: [Authentication & Sessions](../40-api/authentication-and-sessions.md) argued that requiring a password from someone who consults twice a year produces forgotten passwords and abandoned care.

That mechanism is being removed from the product entirely — every code costs money per sign-in, arrives late or not at all on a congested network, and is the one credential in the system that travels over a channel we have already declared non-confidential ([Notifications](../10-product/notifications-sms-whatsapp.md)). The removal is not re-litigated here. What follows is what has to exist in its place, and why the replacement is not simply a weaker OTP.

Two facts made the removal larger than the deletion of a sign-in option.

**One-time-code verification was the only production writer of `users.phone_verified_at` for a patient.** A staff account gets that flag from accepting an invitation, where the token arrived by SMS at the invited number and possession is the proof. No patient account had any equivalent route.

**`PatientRecordClaims` is the only production writer of `patients.user_id`, and it is gated on exactly that flag.** The two compound. With codes removed and nothing else marking a phone verified, no patient record would ever be linked to an account, and the fourteen `P own` rows of the [endpoint catalogue](../40-api/endpoint-catalogue.md) — appointments, prescriptions, the prescription PDF, dispense orders, delivery tracking, receipts, notifications — would return an empty list to every real patient. [ADR-0010](0010-patient-account-link.md) records that precise failure as the reason the column exists at all.

And there was nowhere else to go: the product had **no patient account-creation endpoint and no password-setting path of any kind**. Deleting the code flow without a replacement would not have degraded the patient app. It would have left it with no users.

The market constraint that chose SMS in the first place has not moved. [H1](../10-product/prd-h1-clinic-onboarding.md) and this repository's own schema comments record that most Ugandan clinic staff have a working phone and no reliably-checked email address — and that is more true of patients than of staff, not less.

## Options considered

### A. Keep the one-time code

Not available. The product decision is that no SMS codes exist anywhere, and the controller, table, template and dev command are deleted. Listed for the record, because every option below is worse than it on exactly one axis: a code is *self-service*, and nothing below is.

### B. Emailed set-password link

Staff enter an address; the patient receives a link and chooses their own password.

**For:** nobody but the patient ever knows a credential. On that axis it is strictly better than what we chose.

**Against:** it needs a working email address at the moment of registration, which is the assumption this market punishes. It also puts the credential back into a message — the shape just removed, with an inbox instead of a lock screen — and it fails *silently*: an address mistyped at a busy desk produces no error anybody sees, only an account that is never activated and a patient who assumes the clinic forgot. **Rejected on timing, not on merit.** See Revisit.

### C. Patient self-registration with a chosen password

The patient creates an account on the clinic-branded portal and it attaches to their record.

**Against:** the attaching is the problem. Something has to decide that this account belongs to that clinical record, and with no verified phone the only matcher left is a number typed into a public form. That is a public route by which a stranger who guesses or knows a number gains sight of a medical record — the worst failure this system has, and one [ADR-0010](0010-patient-account-link.md) already refused when it insisted the phone be a *verified* one.

### D. Clinic staff issue the account from the record — chosen

A member of staff, having identified the person at the desk, creates the account against the patient record in front of them.

## Decision

**Patients sign in with an email address and a password, and a member of clinic staff issues the account from the patient's own record.**

`POST /v1/patients/{patient}/account`, callable by `clinic_admin`, `front_desk` or `clinician`:

- Staff supply an **email address**, which becomes the account's only identifier. The account carries **no phone number**.
- The **platform generates the initial password**, returns it exactly once in that response, and stores only its digest.
- The call writes `patients.user_id` for the record **named in the URL**.
- `phone_verified_at` stays **null**.
- `password_change_required_at` is set. While it is set, middleware refuses every authenticated request except `GET /v1/me`, `POST /v1/me/password` and `POST /v1/auth/sign-out`.
- The act writes `patient.account_created`, naming the staff actor and the record. The password is not in it.

`POST /v1/me/password` is unchanged and still requires `current_password` — the patient has it, a staff member read it to them, and relaxing the only password endpoint to accommodate a first sign-in would leave a permanently weaker one for everybody.

### What each basis actually proves

These are different claims, and pretending otherwise is how a trust argument goes wrong.

**An SMS code proves control of a handset at a moment in time.** It says nothing about who is holding it: a reassigned number carries it, a shared family handset defeats it, and a SIM swap defeats it deliberately. Its real virtue was never strength — it was that the patient could do it alone, with no third party ever holding their credential.

**In-person identification proves that a person was physically present and that a named member of clinic staff vouched for them.** It says nothing whatever about a phone number. And it inserts a third party who, for a bounded period, knows the patient's password.

So the swap moves the risk rather than reducing it: from *a message can be intercepted and a number can be reassigned* to *a named employee can act as this patient until they first sign in*. What makes it acceptable is that the second risk has an owner, a name and a timestamp, and the first had none of those. That is the argument — not that it is stronger.

The product had already sanctioned this basis before we needed it: H2's exception table has always allowed front desk to "verify identity in person and attest, as an audited action".

### Why the phone is not marked verified

Because it would be a false claim, and a load-bearing one. `phone_verified_at` is surfaced to clinic administrators through `StaffResource` **specifically so a clinic can tell a genuinely verified contact number from one typed at a front desk**. Writing it on the strength of a desk visit poisons that signal for every consumer of it, in exchange for making one gate pass.

The account also carries no phone number at all. A staff member who is also a patient of their own clinic, and the documented practice of registering a patient against a next-of-kin number, would otherwise collide on `(tenant_id, phone)` — and a unique-key violation at a front desk is a patient turned away.

### Why the server generates the password

A front desk creating twenty accounts a day, asked to choose a password each time, will type the same word twenty times. Then every patient account at that clinic is guessable by anyone who was ever given one — a failure that is silent, clinic-wide and permanent until somebody notices.

The generated password is never stored in the clear, never logged, never placed in audit metadata, and **never sent by SMS**. That last one is not a detail: an SMS carrying a credential is exactly the message shape the deleted code template's own docblock forbade, and recreating it under a different name would undo the reason for this ADR.

### What this changes in ADR-0010

Exactly one section. § *Claiming a record* said: "Two paths, both requiring a **verified** phone." There is now **one path, and it requires no phone at all** — a staff member names the record.

Everything else in [ADR-0010](0010-patient-account-link.md) stands unaltered: the nullable column, the composite foreign key, `ON DELETE SET NULL (user_id)`, one account holding many records, `user_id` absent from `$fillable`, and linking as an explicit act that writes an audit event. The record-scoped call makes that last point more literal than it was — the record is named in the URL by a person, rather than inferred from a string that matched.

## Consequences

**Accepted costs.**

- **A patient with no email address has no portal, full stop.** `users.email` is not null and email is now the patient's only identifier. Care is unaffected — the record, the SMS notifications and in-person service all stand — but the patient app is now for the subset of patients who have an address. The irony is worth stating plainly: this codebase's own migration comment observes that most Ugandan clinic staff have a working phone and no reliably-checked email, and patients are the harder case, not the easier one.
- **A staff member knows the patient's password until the patient first signs in.** Bounded by the forced change; not eliminated.
- **In that window the staff member can sign in as the patient and grant or withdraw consent** — abilities the [RBAC Matrix](../50-security-compliance/rbac-matrix.md) gives to the `patient` role alone, with a dash in every staff column — and the audit trail will record the actor as the patient. **It is invisible after the fact.** `password_change_required_at` bounds the window and `patient.account_created` names who could have opened it, but neither makes a forged consent distinguishable from a real one. Recorded as an accepted risk in the [Threat Model](../50-security-compliance/threat-model.md).
- The issued account **outlives the issuer's own account**, so offboarding a staff member has to include reviewing the patient accounts they issued. That is an operational step, not a technical control.
- **No self-service recovery.** A forgotten password is another desk visit, because there is nothing to send. By design, and a real support cost.
- **Patients have no second factor at all.** The code was the only one this market universally had.
- Registration stops being self-service end to end. H2's under-two-minutes target now covers producing the *record*; the account is a separate, staffed act.

**Benefits.**

- **Account creation has a named actor, a timestamp and a subject record.** The code flow had an anonymous handset. "Who gave this person sight of this record, and when" is answerable for the first time, which is the question a clinic — the data controller — is the one who has to answer.
- **No credential travels over any channel.** Nothing to intercept, no SIM swap, no code brute-force, no per-sign-in SMS cost, and no notification template that has to be trusted with a secret.
- The account-to-record link is **explicit and record-scoped**, so a guardian gains sight of a child's record by a deliberate audited act rather than because two rows shared a phone number.
- One password endpoint, with `current_password` required on it, rather than a second weaker one for first use.

**What this forecloses.** Very little structurally: option B needs no schema change, so adopting it later is additive. Reversing the *staff-issued* part means building account recovery for accounts that already exist — a feature, not a migration.

## Revisit when

- **Patient email becomes common enough at registration** that an emailed set-password link would reach most patients. Then option B becomes the primary path and staff issuance stays as the fallback for patients with no address.
- **A patient-account takeover or a disputed consent grant is reported.** The cheapest real fix is already identified: a patient-visible account history — "your account was created by X on Y, and here is every consent recorded under it" — which turns an invisible act into a detectable one.
- **Anything else in the product needs to prove control of a phone number.** There is now no mechanism at all, and inventing one for a second purpose should reopen this decision rather than quietly restore the first.

## Related

[ADR-0010](0010-patient-account-link.md) · [Authentication & Sessions](../40-api/authentication-and-sessions.md) · [H2 — Patient Registration & Consent](../10-product/prd-h2-patient-registration-consent.md) · [Threat Model](../50-security-compliance/threat-model.md) · [RBAC Matrix](../50-security-compliance/rbac-matrix.md) · [Endpoint Catalogue](../40-api/endpoint-catalogue.md) · [Notifications](../10-product/notifications-sms-whatsapp.md)
