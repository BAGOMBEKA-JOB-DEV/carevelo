import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import {
  Badge,
  Button,
    DateTime,
  Field,
  Icon,
  Input,
  Notice,
  PageHeader,
} from '@carevelo/ui'
import { attempt } from '../api/http'
import {
  consentHistory,
  currentConsentPolicy,
  latestDecisions,
  recordConsent,
  withdrawConsent,
} from '../api/consents'
import { requiresGuardian } from '../api/patients'
import type { ConsentGrantedBy, ConsentRecord, ConsentType, Patient } from '../api/types'
import { CAPTURED_AT_DELIVERY, actionDisplay, consentDisplay } from '../model/consent'
import { isFinalised } from '../model/status'
import type { PatientsPaths } from '../model/paths'
import { ConsentPolicyText } from './ConsentPolicyText'

/**
 * Consent capture at the registration desk.
 *
 * ==========================================================================
 * THE ONE THING THIS SCREEN IS ABOUT: STAFF FACILITATE, THE PATIENT ACTS.
 * ==========================================================================
 *
 * `docs/50-security-compliance/rbac-matrix.md` gives "Consent — grant / withdraw" a tick in
 * the `patient` column and a dash in every staff column, `clinic_admin` included. The endpoint
 * behind this screen is nevertheless authorised by `PatientPolicy::update`, which admits
 * administrator, clinician and front desk — and that is not a contradiction. It is the
 * sentence printed under the matrix: "Consent is granted by the patient or guardian only.
 * Staff may facilitate in person, but the record names who attested."
 *
 * So the person operating this screen is a scribe, and every decision the screen makes follows
 * from that:
 *
 *   - The full policy is on the screen, not behind a link, in the language the patient reads.
 *     A link nobody opens is not information anybody received, and consent obtained from
 *     wording the patient did not understand is not consent.
 *   - There is no pre-ticked box and no default. Two buttons — consents, declines — and
 *     neither is pressed until somebody has answered. `affirmed` has no default in the API for
 *     the same reason: the absence of an affirmative action is not consent.
 *   - Each consent is asked separately. There is no "agree to all", here or in the contract:
 *     `consent_type` is singular and there is no array anywhere, so bundling is unexpressible
 *     rather than merely discouraged.
 *   - A decline is recorded, not skipped. It is what proves the clinic stopped, and it is what
 *     a regulator asks for when a patient says they never agreed.
 *   - `granted_by` is `patient` or `guardian`. Nothing this screen can post attributes a
 *     decision to the member of staff who typed it. The audit event names them separately, as
 *     the person who wrote it down.
 *
 * ==========================================================================
 * THE MINOR CASE, WHICH IS THE ONE MOST EASILY GOT WRONG.
 * ==========================================================================
 *
 * Under 18 and the GUARDIAN decides — for every consent type, not only some. The screen puts
 * the guardian's name and relationship on the form before it is submitted rather than after a
 * 422, and asks the member of staff to attest that they identified that guardian in person.
 *
 * That attestation is the whole trust basis of a guardian's decision and it is worth being
 * exact about what carries it: the guardian's name and relationship go onto the immutable
 * `ConsentRecord`, and the acting staff user is named on the `consent.granted` audit event.
 * Between them, "who decided, and who was standing there when they did" is reconstructable
 * months later, which is what "demonstrable" means in the statute. The tick box itself is
 * stored nowhere, and this file says so rather than letting anybody believe otherwise — it is
 * there to stop a reflexive click on the most consequential form in the product.
 *
 * ==========================================================================
 * A PLAIN FORM POST, NO JAVASCRIPT.
 * ==========================================================================
 *
 * The policy version travels with the decision and comes from the policy that was RENDERED on
 * this page — never from a constant, and never from a hidden input a form could edit. It is
 * bound into the Server Action at render time, so a stale tab cannot post a version against
 * text it is not showing. The API refuses a version it is no longer serving anyway, which is
 * the control; this is what makes the control unnecessary.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

type DecisionRoutes = {
  readonly patientId: string
  readonly consentType: ConsentType
  /** From the policy rendered on this page. Pinned into the record as evidence. */
  readonly policyVersion: string
  /** `patient`, or `guardian` when the record says the patient is under 18. */
  readonly grantedBy: ConsentGrantedBy
  /** This screen's own path, for a failed decision to come back to. */
  readonly returnHref: string
  /** The record. Where a recorded decision goes. */
  readonly recordHref: string
}

async function submitDecision(routes: DecisionRoutes, formData: FormData): Promise<void> {
  'use server'

  const decision = String(formData.get('decision') ?? '')

  /*
   * NEITHER BUTTON WAS PRESSED, so nothing is recorded. Not defensive padding: `affirmed` is a
   * required boolean with no default in the contract precisely because a missing answer must
   * never resolve to one, and a form submitted by pressing Enter in a text field posts no
   * button value at all. Defaulting either way here would be this screen inventing a decision.
   */
  if (decision !== 'granted' && decision !== 'declined') {
    redirect(
      `${routes.returnHref}?error=${encodeURIComponent(
        'No decision was recorded. Ask the patient, then press the button that matches their answer.',
      )}`,
    )
  }

  const text = (name: string): string => String(formData.get(name) ?? '').trim()

  const result = await recordConsent({
    patientId: routes.patientId,
    consentType: routes.consentType,
    affirmed: decision === 'granted',
    policyVersion: routes.policyVersion,
    grantedBy: routes.grantedBy,
    /*
     * Sent only on the guardian path. `guardian_name` is `required_if:granted_by,guardian`, and
     * `RejectsUnknownFields` is on this request — a guardian name with no `granted_by` is a
     * 422 rather than a field the API quietly ignores.
     */
    ...(routes.grantedBy === 'guardian'
      ? {
          guardianName: text('guardian_name'),
          guardianRelationship: text('guardian_relationship'),
        }
      : {}),
  })

  if (!result.ok) {
    /*
     * The API's own sentence, unchanged. It is the one that knows why: "A patient under 18
     * consents through a guardian", "Consent to process data comes first. Without it, nothing
     * else can be agreed", "The consent wording has changed. Show the current policy and ask
     * again." Each of those tells the desk what to do next; a paraphrase would have to guess
     * which rule fired.
     */
    redirect(`${routes.returnHref}?error=${encodeURIComponent(result.message)}`)
  }

  redirect(`${routes.recordHref}?done=consent`)
}

type WithdrawalRoutes = {
  readonly patientId: string
  readonly consentType: ConsentType
  readonly returnHref: string
}

async function submitWithdrawal(routes: WithdrawalRoutes): Promise<void> {
  'use server'

  const result = await withdrawConsent(routes.patientId, routes.consentType)

  if (!result.ok) {
    // Including "There is no active consent of that kind to withdraw", which is what a second
    // press on a stale page produces. The API's sentence says exactly that; a paraphrase would
    // have to guess which of several 409s it was.
    redirect(`${routes.returnHref}?error=${encodeURIComponent(result.message)}`)
  }

  redirect(`${routes.returnHref}?done=withdrawn`)
}

export type ConsentDeskScreenProps = {
  paths: PatientsPaths
  /** Read by the route, so a record that is not this clinic's is a 404 there. */
  patient: Patient
  /** `?policy=` — which language rendering of the policy to show the patient. */
  language?: string | undefined
  /** `?error=` — the API's sentence from a decision that was refused. */
  error?: string | undefined
  /** `?done=withdrawn` — set by a withdrawal, which stays on this screen. */
  done?: string | undefined
}

export async function ConsentDeskScreen({
  paths,
  patient,
  language,
  error,
  done,
}: ConsentDeskScreenProps): Promise<ReactElement> {
  const recordHref = paths.record(patient.id)
  const returnHref = paths.consent(patient.id)

  const heading = (
    <PageHeader
      title="Consent"
      description={
        <>
          {patient.given_name} {patient.family_name}
        </>
      }
      actions={
        <Button href={recordHref} variant="quiet">
          Back to the record
        </Button>
      }
    />
  )

  /*
   * A discarded registration cannot be consented — `ConsentController` throws before it looks
   * at the decision. The desk is told first, with the API's own reasoning, rather than filling
   * a form in with a patient at the counter and being refused at the end of it.
   */
  if (isFinalised(patient.status)) {
    return (
      <>
        {heading}
        <Notice tone="warn" icon="shield" title="This registration ended when consent was declined">
          Declining is the answer being respected, and it is final on this record. If this person
          now wants to be treated here, register them again from the start.
        </Notice>
      </>
    )
  }

  const [policy, history] = await Promise.all([
    attempt(currentConsentPolicy()),
    attempt(consentHistory(patient.id)),
  ])

  /*
   * NO POLICY, NO FORM. A consent screen with the wording missing is a consent screen that
   * collects agreement to text nobody was shown, and the record would pin a hash to a document
   * the patient never read. So the failure is total by design: an explanation, and no buttons.
   */
  if (!policy.ok) {
    return (
      <>
        {heading}
        <Notice tone="bad" announce title="The consent policy could not be loaded">
          <p>
            {policy.message
              ?? 'The request did not reach the API. Nothing has been recorded and nothing has changed.'}
          </p>
          <p style={{ marginTop: 'var(--space-4)' }}>
            No consent can be captured without the exact wording the patient is agreeing to on
            screen in front of them. Try again in a moment; if it keeps failing, tell the
            patient the clinic will complete their registration and contact them.
          </p>
        </Notice>
      </>
    )
  }

  const languages = Object.keys(policy.value.text)
  const shown = language !== undefined && languages.includes(language) ? language : languages[0]
  const prose = shown === undefined ? undefined : policy.value.text[shown]

  const latest = history.ok ? latestDecisions(history.value.records) : {}
  const guardianDecides = requiresGuardian(patient.date_of_birth)

  const dataProcessingGranted = latest['data_processing']?.action === 'granted'

  return (
    <>
      {heading}

      <div className="grid">
        {error !== undefined ? (
          <Notice tone="bad" announce title="Nothing was recorded">
            {error}
          </Notice>
        ) : null}

        {done === 'withdrawn' ? (
          <Notice tone="info" icon="check" announce title="Withdrawal recorded">
            The grant it revokes is left exactly as it was written — a withdrawal is a new
            record, never an edit. New processing stops; the medical record already on file is
            kept for as long as the clinic is obliged to keep it.
          </Notice>
        ) : null}

        <Notice tone="info" icon="users" title="You are recording their decision, not making it">
          Turn the screen towards the patient, or read the policy to them. Ask each question
          separately and press the button that matches the answer they actually give. Nothing on
          this screen is ticked in advance and nothing is agreed by continuing.
        </Notice>

        {guardianDecides ? (
          <Notice tone="warn" icon="shield" announce title="This patient is under 18">
            The guardian decides on their behalf, for every consent below. Name the guardian on
            the form, and only record a decision if you have identified that person in front of
            you. Their name and relationship go onto the consent record; the audit trail names
            you as the member of staff who recorded it.
          </Notice>
        ) : null}

        {!history.ok ? (
          <Notice tone="warn" title="The existing consent history could not be loaded">
            {history.message
              ?? 'The request did not reach the API. You can still record a decision below, but this screen cannot show you what was already agreed — so check with the patient before asking again.'}
          </Notice>
        ) : null}

        {/* ---- The policy, in full, in the patient's language --------------- */}
        <section className="card stack" aria-labelledby="policy-title">
          <div className="row between">
            <h2 className="title-sm grow">What the patient is agreeing to</h2>
            {languages.length > 1 ? (
              <nav className="row-wrap" aria-label="Policy language">
                {languages.map((code) => (
                  <Button
                    key={code}
                    variant={code === shown ? 'primary' : 'quiet'}
                    href={`${returnHref}?policy=${encodeURIComponent(code)}`}
                    aria-current={code === shown ? 'true' : undefined}
                  >
                    {languageName(code)}
                  </Button>
                ))}
              </nav>
            ) : null}
          </div>

          <p className="muted">
            This is the exact wording pinned to whatever the patient decides. Show it to them —
            it is not a summary and it is not behind a link.
          </p>

          {prose === undefined || shown === undefined ? (
            <Notice tone="bad" announce>
              The policy has no text in any language this console received. Do not record a
              decision: there is nothing to show the patient.
            </Notice>
          ) : (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <ConsentPolicyText text={prose} lang={shown} titleId="policy-title" />
            </div>
          )}

          <details style={{ marginTop: 'var(--space-5)' }}>
            <summary style={SUMMARY}>The version and fingerprint recorded with the decision</summary>
            <p className="muted" style={{ marginTop: 'var(--space-3)', fontSize: 13 }}>
              Every consent record pins these. Months later the versioned wording can be
              re-rendered and checked against the fingerprint, which is how the clinic proves
              nothing was quietly changed after the patient agreed to it.
            </p>
            <dl className="stack" style={{ marginTop: 'var(--space-4)' }}>
              <dt className="field__label">Version</dt>
              <dd className="tnum">{policy.value.version}</dd>
              <dt className="field__label" style={{ marginTop: 'var(--space-3)' }}>
                Fingerprint
              </dt>
              {/* Whole, not truncated: a shortened hash cannot be checked against anything,
                  which would make showing it theatre. */}
              <dd className="identifier">
                <code>{policy.value.text_hash}</code>
              </dd>
            </dl>
          </details>
        </section>

        {/* ---- One question at a time -------------------------------------- */}
        {policy.value.consent_types.map((type) => (
          <ConsentQuestion
            key={type}
            type={type}
            patient={patient}
            latest={latest[type]}
            guardianDecides={guardianDecides}
            dataProcessingGranted={dataProcessingGranted}
            policyVersion={policy.value.version}
            returnHref={returnHref}
            recordHref={recordHref}
          />
        ))}

        {/* ---- Taking it back ---------------------------------------------- */}
        <WithdrawalSection
          patient={patient}
          latest={latest}
          types={policy.value.consent_types}
          returnHref={returnHref}
        />

        {history.ok ? <History records={history.value.records} /> : null}
      </div>
    </>
  )
}

/**
 * One consent, asked once.
 *
 * FOUR DIFFERENT SCREENS LIVE IN HERE and each is a rule rather than a state:
 *
 *   1. `delivery_disclosure` is never asked at the desk. Consent must be SPECIFIC, and asking
 *      up front for a disclosure that may never happen is not specific — the patient has not
 *      chosen delivery and may never choose it. `ConsentController` refuses it outright while
 *      the record is still awaiting consent, and H4 takes it at the moment delivery is chosen.
 *   2. Anything other than `data_processing` is refused until `data_processing` is granted.
 *      Without consent to process at all, nothing else can be agreed — so the buttons are not
 *      rendered, and the reason is written where the buttons would have been. A disabled
 *      control with no explanation teaches staff that the product is broken.
 *   3. A decision already made is shown as made, with the option to ask again. Asking again is
 *      legitimate — a patient may change their mind, and the new record supersedes without
 *      erasing — but it must not look like the question was never put.
 *   4. Otherwise: the question, and two buttons.
 *
 * DECLINING `data_processing` ENDS THE REGISTRATION, and this is the one place in the product
 * where a button press destroys data. `ConsentController::discard()` clears the email, date of
 * birth, sex, national ID, address and district on the spot and moves the record to
 * `discarded`, from which nothing recovers it. The warning is right beside the button, not in a
 * confirmation dialog somebody learns to dismiss.
 */
function ConsentQuestion({
  type,
  patient,
  latest,
  guardianDecides,
  dataProcessingGranted,
  policyVersion,
  returnHref,
  recordHref,
}: {
  type: ConsentType
  patient: Patient
  latest: ConsentRecord | undefined
  guardianDecides: boolean
  dataProcessingGranted: boolean
  policyVersion: string
  returnHref: string
  recordHref: string
}): ReactElement {
  const display = consentDisplay(type)
  const headingId = `consent-${type}`

  const asked = latest !== undefined
  const blocked = type !== 'data_processing' && !dataProcessingGranted

  return (
    <section className="card stack" aria-labelledby={headingId}>
      <div className="row between">
        <h2 className="title-sm grow" id={headingId}>
          {display.label}
        </h2>
        {asked ? (
          <Badge tone={actionDisplay(latest.action).tone}>{actionDisplay(latest.action).label}</Badge>
        ) : (
          <Badge>Not asked</Badge>
        )}
      </div>

      <p className="muted">{display.purpose}</p>

      {asked && latest.occurred_at !== null ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Last answered <DateTime value={latest.occurred_at} format="datetime" />
          {latest.granted_by === 'guardian' ? (
            <> by {latest.guardian_name ?? 'a guardian'}
              {latest.guardian_relationship === null ? '' : ` (${latest.guardian_relationship})`}
            </>
          ) : (
            ' by the patient'
          )}
          .
        </p>
      ) : null}

      {type === CAPTURED_AT_DELIVERY ? (
        <Notice tone="info" icon="truck" title="Not asked here">
          This one is taken at the moment the patient chooses delivery over collection, on the
          pharmacy screen. Consent has to be specific, and agreeing in advance to a disclosure
          that may never happen is not specific. The rider is never given a diagnosis or a list
          of medicines either way.
        </Notice>
      ) : blocked ? (
        <Notice tone="warn" icon="lock" title="Ask about the use of health information first">
          Without consent to use their information at all, nothing else can be agreed. Record
          that decision above, then come back to this one.
        </Notice>
      ) : (
        <form
          action={submitDecision.bind(null, {
            patientId: patient.id,
            consentType: type,
            policyVersion,
            /*
             * BOUND AT RENDER FROM THE RECORD'S DATE OF BIRTH, not posted by the form. A hidden
             * `granted_by` field would be a control that decides whether a child's own tick
             * counts as a lawful basis, editable by anyone who can open developer tools. The
             * API re-checks and refuses a minor's own decision regardless — this is what stops
             * the desk meeting that refusal after filling the form in.
             */
            grantedBy: guardianDecides ? 'guardian' : 'patient',
            returnHref,
            recordHref,
          })}
          className="stack"
          style={{ gap: 'var(--space-5)', marginTop: 'var(--space-4)' }}
        >
          <p>
            <strong>{display.ask}</strong>
          </p>

          {guardianDecides ? (
            <div className="grid g-2">
              <Field
                name="guardian_name"
                label="Guardian’s name"
                id={`${headingId}-guardian-name`}
                hint="The person answering, as they give it."
              >
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    maxLength={200}
                    required
                    autoComplete="off"
                    defaultValue={patient.guardian.name ?? undefined}
                  />
                )}
              </Field>

              <Field
                name="guardian_relationship"
                label="Relationship to the patient"
                id={`${headingId}-guardian-relationship`}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    maxLength={60}
                    required
                    autoComplete="off"
                    defaultValue={patient.guardian.relationship ?? undefined}
                  />
                )}
              </Field>
            </div>
          ) : null}

          {/*
            A plain checkbox rather than <Choice>, because this is not one option among
            several — it is a single condition that has to be true before either button means
            anything. `required` is what makes it a condition rather than a suggestion, and it
            works with no JavaScript.

            SAID PLAINLY BECAUSE IT MATTERS: this tick is stored nowhere. What IS stored is the
            guardian's name and relationship on the immutable consent record, and the acting
            staff member on the audit event. The tick exists to make the press deliberate on the
            most consequential form in the product.
          */}
          <label className="row" htmlFor={`${headingId}-attested`}>
            <input
              className="choice__input"
              id={`${headingId}-attested`}
              name="attested"
              type="checkbox"
              value="yes"
              required
            />
            <span className="choice__text">
              <span>
                {guardianDecides
                  ? 'I identified this guardian in person and put the question to them.'
                  : 'I put this question to the patient in person and this is their answer.'}
              </span>
            </span>
          </label>

          {type === 'data_processing' ? (
            <Notice tone="warn" icon="shield" title="If they decline, the registration ends here">
              Declining is a decision the clinic respects and records. It also clears the email,
              date of birth, sex, national ID and address collected during this registration on
              the spot, and the record can never be edited, consented or given an account again.
              Nothing recovers it — they would have to be registered from scratch.
            </Notice>
          ) : null}

          <div className="row-wrap">
            <Button type="submit" name="decision" value="granted" variant="primary">
              <Icon name="check" /> {asked ? 'They now consent' : 'They consent'}
            </Button>
            <Button type="submit" name="decision" value="declined" variant="quiet">
              They decline
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * Taking a consent back.
 *
 * PER TYPE, for the same reason granting is per type: a patient who no longer wants remote
 * consultations has not withdrawn consent to be treated at all, and collapsing the two would
 * either over-read or under-read what they actually said.
 *
 * THE SENTENCE THE WHOLE SECTION IS WRITTEN AROUND — read the retention document before
 * editing a word of it. Withdrawing halts NEW processing. It does not delete a medical record
 * the clinic may be legally obliged to keep, and the clinic will say plainly which parts can
 * be removed and which cannot. A promise of erasure nobody can keep is worse than an honest
 * explanation of a real tension, and it is worse still at a counter, where the person making
 * the promise is standing in front of the patient.
 *
 * @see docs/50-security-compliance/data-retention-and-deletion.md
 */
function WithdrawalSection({
  patient,
  latest,
  types,
  returnHref,
}: {
  patient: Patient
  latest: Readonly<Record<string, ConsentRecord>>
  types: readonly ConsentType[]
  returnHref: string
}): ReactElement | null {
  const withdrawable = types.filter((type) => latest[type]?.action === 'granted')

  if (withdrawable.length === 0) {
    return null
  }

  return (
    <section className="card stack" aria-labelledby="withdraw-heading">
      <h2 className="title-sm" id="withdraw-heading">
        Withdrawing a consent
      </h2>

      <p className="muted">
        The patient may take any of these back at any time, and this is where you record that
        they have. A withdrawal is written as a new record; the grant it revokes is left exactly
        as it was, because a consent history that can be edited proves nothing at all.
      </p>

      <p className="muted">
        Withdrawing stops new use of their information. It does not delete the medical record
        already on file — the clinic may be legally obliged to keep it. Tell the patient that
        plainly rather than promising an erasure nobody can carry out.
      </p>

      {latest['data_processing']?.action === 'granted' ? (
        <Notice tone="warn" icon="shield">
          Withdrawing consent to use health information moves this patient out of active care.
          Nothing new can be booked, consulted or dispensed until consent is given again.
        </Notice>
      ) : null}

      <div className="row-wrap" style={{ marginTop: 'var(--space-4)' }}>
        {withdrawable.map((type) => (
          <form
            key={type}
            action={submitWithdrawal.bind(null, {
              patientId: patient.id,
              consentType: type,
              returnHref,
            })}
          >
            <Button type="submit" variant="quiet">
              Withdraw: {consentDisplay(type).label}
            </Button>
          </form>
        ))}
      </div>
    </section>
  )
}

/**
 * The decisions already on this record, in sequence.
 *
 * HISTORY, NOT CURRENT STATE, AND THAT IS THE POINT. A withdrawal is a new record and the
 * grant it revokes stays exactly as written, so this lists grants, declines and withdrawals
 * together rather than a tidy "consented to X" summary. A list that quietly hid superseded
 * entries would be indistinguishable from one that can be edited.
 *
 * ONE PAGE, DELIBERATELY. The API orders newest first and pages by cursor; the current state
 * of every consent type is on the first page unless a patient has made more than twenty-five
 * decisions, and a desk that needs to go further back is auditing rather than registering. The
 * full history is the API's to serve and this screen is not the place to page through it.
 */
function History({ records }: { records: readonly ConsentRecord[] }): ReactElement | null {
  if (records.length === 0) {
    return null
  }

  return (
    <section className="card" aria-labelledby="history-heading">
      <h2 className="title-sm" id="history-heading" style={{ marginBottom: 'var(--space-4)' }}>
        Everything decided so far
      </h2>

      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Consent decisions, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Consent</th>
              <th scope="col">Decision</th>
              <th scope="col">Who decided</th>
              <th scope="col">When</th>
              <th scope="col">Policy version</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const action = actionDisplay(record.action)

              return (
                <tr key={record.id}>
                  <td>{consentDisplay(record.consent_type).label}</td>
                  <td>
                    <Badge tone={action.tone}>{action.label}</Badge>
                  </td>
                  <td>
                    {record.granted_by === 'guardian'
                      ? `${record.guardian_name ?? 'Guardian'}${
                          record.guardian_relationship === null
                            ? ''
                            : ` (${record.guardian_relationship})`
                        }`
                      : 'The patient'}
                  </td>
                  <td>
                    {record.occurred_at === null ? (
                      <span className="muted">—</span>
                    ) : (
                      <DateTime value={record.occurred_at} format="datetime" />
                    )}
                  </td>
                  <td className="tnum">{record.policy_version}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * The name of a language, for a button a receptionist presses on a patient's behalf.
 *
 * IN THE LANGUAGE ITSELF — "Luganda", not "Luganda (lg)". The person choosing is frequently
 * the patient, reaching across the counter, and the whole point of the control is that they
 * can recognise their own language without reading English first. An unknown code shows as
 * itself rather than as a guess, which is what the API returning a third translation should
 * look like on the day before this list learns about it.
 */
function languageName(code: string): string {
  switch (code) {
    case 'en':
      return 'English'
    case 'lg':
      return 'Luganda'
    default:
      return code
  }
}

/** The disclosure row is a control, so it answers to the same 44px touch floor. */
const SUMMARY = {
  cursor: 'pointer',
  minHeight: 'var(--touch-min)',
  display: 'flex',
  alignItems: 'center',
  fontWeight: 600,
} as const
