import { write, type Outcome } from './http'
import type { IssuedAccount } from './types'

/**
 * Giving a patient their own way in, issued across the registration desk.
 *
 * ------------------------------------------------------------
 * THE ONE FACT EVERY SCREEN AROUND THIS CALL IS BUILT ON.
 *
 * The API GENERATES the password and returns it in the 201 body. That is the only moment the
 * plaintext exists anywhere outside the patient's own head: it is stored as a hash, it is in
 * no audit event, no log line, no notification and no SMS, and there is no endpoint — none,
 * not for an administrator, not for Carevelo — that can produce it again. If the response is
 * not read by a human being before the page changes, the credential is gone and the only
 * remedy is a different address and a different account.
 *
 * Everything the account screen does follows from that: it renders the password in the SAME
 * response that created it, it never redirects afterwards, it puts the value in no URL and no
 * cookie, it says out loud that it cannot be recovered, and it tells the staff member to read
 * it to the patient. It offers no "email it" and no "send by SMS", because both would take a
 * credential that currently exists only on one screen and put it on an untrusted transport —
 * SMS transits the mobile operator and lands on a lock screen, and the notification channels
 * are documented as never carrying anything of the kind.
 *
 * ------------------------------------------------------------
 * WHY STAFF DO THIS AND NOT THE PATIENT.
 *
 * The account grants a human being sight of a medical record, so something has to establish
 * that the human being is the right one. `PatientPolicy::createAccount` admits the
 * administrator and the front desk and NOT the clinician — "this is a registration-desk act,
 * and the desk is where the person and their ID document actually are" — and not the patient
 * either, because self-service would mean anybody who knows a name and a record identifier
 * could mint a login onto a medical record.
 *
 * The corollary is written into the RBAC matrix as an accepted risk rather than hidden: the
 * issuer knows the password until the patient replaces it at first sign-in, and during that
 * window could sign in as them and exercise the patient's own column — consent included. That
 * is why `RequirePasswordChange` refuses everything but three routes until the password is
 * changed, and why the screen's copy pushes the patient to sign in and change it now.
 *
 * ------------------------------------------------------------
 * NO IDEMPOTENCY KEY, AND THAT IS THE SAFE DIRECTION HERE.
 *
 * `PaymentIntentController` is the only handler that reads the header. A second submission
 * therefore reaches the controller and is refused with a 409 rather than replaying the stored
 * 201 — which is what we want: a replayed 201 would show a SECOND copy of a password that was
 * only ever valid once, and a member of staff reading it to a patient would be reading a
 * string that does not open anything.
 *
 * @see backend/app/Http/Controllers/Api/V1/PatientAccountController.php
 * @see docs/70-decisions/0011-staff-issued-patient-accounts.md
 * @see docs/50-security-compliance/rbac-matrix.md
 */

/**
 * Create the patient's account, link it to their record, and return the password once.
 *
 * `email` IS THE ONLY FIELD, AND THE TWO ABSENT ONES ARE THE POINT.
 *
 *   - `password` is PROHIBITED by the request. Somebody who can write another person's
 *     password can read everything that person can reach; and a desk creating twenty accounts
 *     a day would type the same password twenty times, after which every account at that
 *     clinic is guessable by anyone who was ever given one.
 *   - `name` is PROHIBITED. The account is named from the patient record, so there is only
 *     ever one spelling of a patient's name to keep right.
 *
 * There is no `phone` either. `users` carries `unique(tenant_id, phone)`, and the two ordinary
 * collisions — a member of staff who is also a patient here, and a record registered against a
 * next-of-kin number — would each turn a legitimate desk action into a duplicate-key failure.
 * Notifications are unaffected: ownership resolves through `patients.phone`.
 *
 * THE THREE REFUSALS A DESK ACTUALLY MEETS, all with the API's own wording:
 *
 *   - 409 `patient_already_has_account` — they already have one, and a lost password cannot
 *     be reissued here. `PatientResource.has_account` says so before the form is ever shown,
 *     so this is the race between two terminals rather than the common case.
 *   - 409 `account_exists` — that address already has an account at this clinic. Deliberately
 *     a clear answer rather than a neutral one: the caller is authenticated staff who can
 *     already read every record and address here, so there is no enumeration surface to
 *     protect, and there IS a person at a desk who needs to be told the truth.
 *   - 409 `illegal_transition` — the record was merged away, or the registration ended when
 *     consent was declined. Both sentences say what to do instead.
 *
 * And the refusal that is not an error at all: a patient with no email address cannot have an
 * account, because an address is the credential. The API's own message says a patient without
 * one "is registered and treated as normal; create the account when they have one" — care is
 * never blocked on this. The screen refuses before submitting rather than letting a desk
 * invent a placeholder address, which would create an account nobody can ever sign into.
 */
export async function issueAccount(
  patientId: string,
  email: string,
): Promise<Outcome<{ data: IssuedAccount }>> {
  return write<{ data: IssuedAccount }>(
    'POST',
    `/v1/patients/${encodeURIComponent(patientId)}/account`,
    { email },
  )
}
