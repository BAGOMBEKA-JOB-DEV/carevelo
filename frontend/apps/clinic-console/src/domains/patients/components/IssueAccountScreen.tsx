import type { ReactElement, ReactNode } from 'react'
import { Button, Icon, Notice } from '@carevelo/ui'
import { issueAccount } from '../api/account'
import type { Patient } from '../api/types'
import { isFinalised, statusDisplay } from '../model/status'
import type { PatientsPaths } from '../model/paths'
import { IssueAccountForm, type IssueAccountState } from './IssueAccountForm'

/**
 * Issuing a patient their own way in, across the registration desk.
 *
 * ==========================================================================
 * THE FACT THIS WHOLE SCREEN IS BUILT AROUND.
 * ==========================================================================
 *
 * The API generates the password and returns it in the 201 body. That is the only moment the
 * plaintext exists outside the patient's own head: stored as a hash, in no audit event, no log
 * line, no notification, no SMS, and there is no endpoint anywhere — not for an administrator,
 * not for Carevelo — that can produce it again.
 *
 * So the screen shows it once, in the response that created it, says plainly that it cannot be
 * recovered, and tells the member of staff to read it to the patient. It offers no way to email
 * or text it, and it never will: those are untrusted transports that land on a lock screen and
 * transit a mobile operator, and this product's notification channels are documented as never
 * carrying anything of the kind. `IssueAccountForm` is the one 'use client' in this domain
 * precisely because a redirect would have to put the credential in a URL or a cookie.
 *
 * ==========================================================================
 * THE THREE TIMES THIS SCREEN REFUSES BEFORE IT ASKS THE API.
 * ==========================================================================
 *
 * Each is a real state a front desk meets, and each fails obscurely if the screen just posts
 * and shows whatever comes back:
 *
 *   1. NO EMAIL ADDRESS ON THE RECORD. A patient signs in with an address, so without one there
 *      is nothing to create the account against. This is the case the brief calls out and it is
 *      the one most likely to be worked around: told only "email is required", a receptionist
 *      types something to get past the form, and the result is an account nobody can ever sign
 *      into which permanently occupies that address at this clinic. So the screen refuses,
 *      explains that the patient is registered and treated exactly as normal without one — care
 *      is never blocked on this — and sends them to correct the record instead.
 *   2. THEY ALREADY HAVE ONE. `has_account` is on the resource for exactly this, and the answer
 *      matters more than it looks: a lost password cannot be reissued, here or anywhere. Saying
 *      so is the difference between a receptionist telling the patient the truth and promising
 *      to "get it resent".
 *   3. THE RECORD CANNOT HOLD AN ACCOUNT. Merged away, or the registration ended when consent
 *      was declined. The API throws an `IllegalTransition` with its own sentence for both.
 *
 * The API remains the authority on all three — it re-checks every one and answers 409 — and the
 * two 409s a race can still produce come back in the API's own words. Asking first is what
 * stops a desk filling a form in with a patient at the counter and being refused at the end.
 *
 * ==========================================================================
 * WHO MAY DO THIS.
 * ==========================================================================
 *
 * `PatientPolicy::createAccount` admits the administrator and the front desk, and deliberately
 * not the clinician: the trust basis of the account is "a member of staff verified the human
 * being in front of them", and a clinician mid-consultation in a back room is not positioned to
 * do that. Not the patient either, on their own record — self-service would mean anybody who
 * knows a name and a record identifier could mint a login onto a medical record.
 *
 * This console has no session surface yet, so the screen cannot grey the action out for a
 * clinician in advance; the API's 403 is the control and comes back as the API's own sentence.
 * See the handover note for the one field on `MeResource` that would let the UI say it first.
 *
 * @see docs/70-decisions/0011-staff-issued-patient-accounts.md
 * @see docs/50-security-compliance/rbac-matrix.md
 */

type AccountBinding = {
  readonly patientId: string
  /**
   * THE ADDRESS IS BOUND AT RENDER, NOT POSTED.
   *
   * It comes off the record the server just read and is closed over by the action, so it cannot
   * be edited in the form — the same reasoning `CreatePatientAccountRequest` uses to prohibit
   * `name` outright: one spelling of a patient's details, in one place. A text input here would
   * let a desk create an account against an address the clinic does not hold, which is a login
   * the record cannot explain and a second copy of a contact detail free to drift from the
   * first. If the address is wrong, the record is what gets corrected.
   */
  readonly email: string
}

async function issueAccountAction(
  binding: AccountBinding,
  _previous: IssueAccountState,
  formData: FormData,
): Promise<IssueAccountState> {
  'use server'

  /*
   * The attestation, re-checked here rather than left to the browser's `required`.
   *
   * It is stored nowhere and it is not a security control — anybody able to post this form is
   * already authenticated staff who can read every record at this clinic. What it is is the one
   * moment the product asks somebody to confirm, deliberately, that the person is actually in
   * front of them, and a check that only exists in markup is a check that is not there at all
   * for a request assembled by hand. Refusing costs nothing and means the tick is a condition
   * rather than decoration.
   */
  if (formData.get('attested') !== 'yes') {
    return {
      kind: 'refused',
      message:
        'Confirm that the patient is with you and that you have checked their identity document. '
        + 'The account gives whoever holds it sight of a medical record.',
    }
  }

  const result = await issueAccount(binding.patientId, binding.email)

  if (!result.ok) {
    /*
     * The API's own sentence, unchanged. It is the one that knows which 409 this is — "They sign
     * in with the address the clinic already holds. If they have lost the password, they can no
     * longer be given a new one here", "Use a different address, or ask the patient to sign in
     * with the one they have", "This registration was a duplicate and its history moved to
     * another record." Each tells the desk what to do next; a paraphrase would have to guess.
     */
    return { kind: 'refused', message: result.message }
  }

  /*
   * The one and only copy, handed to render state. Deliberately NOT put in a cookie, a URL, a
   * revalidation tag or a log line on the way past — see the note at the top of
   * `IssueAccountForm`.
   *
   * `email` is taken from the RESPONSE rather than from the binding: the API lowercases and
   * trims the address it actually stored, and a receptionist reading back a different casing
   * from the one that will work is a support call the day the patient cannot sign in.
   *
   * The API also returns a `note` saying much the same thing as the screen's own copy. It is
   * deliberately not echoed: two instructions side by side in slightly different words is how a
   * person ends up reading neither.
   */
  return {
    kind: 'issued',
    email: result.data.data.email ?? binding.email,
    password: result.data.data.initial_password,
  }
}

export type IssueAccountScreenProps = {
  paths: PatientsPaths
  /** Read by the route, so a record that is not this clinic's is a 404 there. */
  patient: Patient
}

export function IssueAccountScreen({ paths, patient }: IssueAccountScreenProps): ReactElement {
  const recordHref = paths.record(patient.id)
  const patientName = `${patient.given_name} ${patient.family_name}`

  const heading = (
    <div className="page-head">
      <div className="grow">
        <h1>Portal account</h1>
        <p>{patientName}</p>
      </div>
      <Button href={recordHref} variant="quiet">
        Back to the record
      </Button>
    </div>
  )

  if (patient.merged_into_patient_id !== null) {
    return (
      <Refusal heading={heading} title="This registration was a duplicate">
        <p>
          Its history moved to another record, and an account belongs on the record that
          survived. Open that one and issue it from there.
        </p>
        <p style={{ marginTop: 'var(--space-4)' }}>
          <Button href={paths.record(patient.merged_into_patient_id)}>
            Open the record that survived
          </Button>
        </p>
      </Refusal>
    )
  }

  if (isFinalised(patient.status)) {
    return (
      <Refusal heading={heading} title="This registration ended when consent was declined">
        {statusDisplay(patient.status).meaning}
      </Refusal>
    )
  }

  if (patient.has_account) {
    return (
      <Refusal heading={heading} title="This patient already has an account" tone="info">
        <p>
          They sign in with the address the clinic already holds. Nothing more is needed and
          nothing can be issued a second time.
        </p>
        <p style={{ marginTop: 'var(--space-4)' }}>
          If they have lost the password it cannot be given to them again — not here, not by an
          administrator, and not by Carevelo. It was shown once when the account was created and
          is stored only as a hash. A patient in that position needs a different account against
          a different address.
        </p>
      </Refusal>
    )
  }

  if (patient.email === null || patient.email.trim() === '') {
    return (
      <Refusal heading={heading} title="This record has no email address">
        <p>
          A patient signs in with an email address, so one has to be on the record before an
          account can exist. {patientName} is registered and can be booked, consulted and
          dispensed to exactly as normal without one — an account is a convenience, never a
          condition of care. Add the address when they have one and come back.
        </p>
        <p style={{ marginTop: 'var(--space-4)' }}>
          <strong>Do not invent an address to get past this.</strong> An account created against
          an address the patient does not control is a login nobody can ever sign into, and it
          permanently occupies that address at this clinic — the next attempt, with their real
          address or not, is refused.
        </p>
        <p style={{ marginTop: 'var(--space-4)' }}>
          <Button href={paths.details(patient.id)}>
            <Icon name="mail" /> Add an email address
          </Button>
        </p>
      </Refusal>
    )
  }

  return (
    <>
      {heading}

      <div className="grid">
        <Notice tone="warn" icon="shield" title="Before you create this">
          <p>
            An account lets whoever holds it read {patientName}’s medical record. The only check
            standing behind that is you, at this desk, with them and their identity document in
            front of you — there is no other verification anywhere in the product.
          </p>
          <p style={{ marginTop: 'var(--space-4)' }}>
            The system generates the password and shows it to you once. You read it to the
            patient; it is never emailed, never texted, and cannot be looked up afterwards.
          </p>
        </Notice>

        <IssueAccountForm
          /*
           * Bound to this patient and this address on the server before it crosses to the
           * client, so neither can be changed by the form. Only plain strings go over this
           * boundary — the paths object holds functions and would not serialise.
           */
          action={issueAccountAction.bind(null, {
            patientId: patient.id,
            email: patient.email,
          })}
          email={patient.email}
          patientName={patientName}
          recordHref={`${recordHref}?done=account`}
        />
      </div>
    </>
  )
}

/**
 * A screen that exists to say no, and to say what to do instead.
 *
 * ITS OWN COMPONENT BECAUSE THE REFUSALS OUTNUMBER THE ACTION, three to one, and each of them
 * is somewhere a desk would otherwise invent a workaround. A refusal that only says what went
 * wrong is a refusal somebody routes around; every one of these ends with the next step.
 */
function Refusal({
  heading,
  title,
  tone = 'warn',
  children,
}: {
  heading: ReactNode
  title: string
  tone?: 'warn' | 'info' | undefined
  children: ReactNode
}): ReactElement {
  return (
    <>
      {heading}
      <Notice tone={tone} icon="shield" announce title={title}>
        {children}
      </Notice>
    </>
  )
}
