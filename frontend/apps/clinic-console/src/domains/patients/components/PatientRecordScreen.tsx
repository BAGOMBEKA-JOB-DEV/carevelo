import type { ReactElement, ReactNode } from 'react'
import { Badge, Button, DateTime, Icon, Notice, PageHeader } from '@carevelo/ui'
import { attempt } from '../api/http'
import { consentHistory, latestDecisions } from '../api/consents'
import type { Patient } from '../api/types'
import { actionDisplay, consentDisplay } from '../model/consent'
import { isFinalised, statusDisplay } from '../model/status'
import type { PatientsPaths } from '../model/paths'

/**
 * One patient's record — the hub every other screen in this domain returns to.
 *
 * ------------------------------------------------------------
 * THE STATE IS THE HEADLINE, NOT A FIELD IN A TABLE.
 *
 * The console's standing caution for this section is that a record in `pending_consent` may
 * carry no clinical data at all, "enforced in the database rather than by this screen — but
 * the screen has to make the state obvious, because a member of staff who cannot see why a
 * note will not save will find a way around the product." So the status appears three times
 * over: as a badge beside the name, as a sentence explaining what it means for the work in
 * front of the person reading it, and as the reason certain actions are absent.
 *
 * ------------------------------------------------------------
 * WHAT `phone_verified` DOES AND DOES NOT SAY ON THIS SCREEN.
 *
 * It is TRUE only when a token proved control of that handset. A desk visit proves nothing of
 * the kind and never sets it — `PatientAccountController` leaves `phone_verified_at` NULL
 * deliberately, so that a clinic can tell a genuinely verified contact number from one typed
 * at a counter — which makes FALSE the ordinary case for very nearly every record here.
 *
 * So false is rendered as nothing at all. No warning, no "unverified" chip, and above all no
 * suggestion anywhere on this surface that somebody could go and verify the number: there is
 * no such action in the product, and a screen that implies one sends a receptionist looking
 * for a button that does not exist and leaves them believing the record is deficient. A
 * confirmed number is worth marking because it is rare and useful; the absence of one is not
 * news.
 *
 * ------------------------------------------------------------
 * READING THIS RECORD IS ITSELF AUDITED. `PatientController::show` writes a `patient.viewed`
 * event on every call, because the consent policy promises the patient in writing that "every
 * time a member of staff opens your record that access is recorded". The route reads the
 * patient once and hands it in; nothing here re-reads it to fill a gap.
 */

export type PatientRecordScreenProps = {
  paths: PatientsPaths
  /** Read by the route, so a record that is not this clinic's can be a 404 there. */
  patient: Patient
  /** `?done=` — what the desk just finished, echoed back so the page can confirm it. */
  done?: string | undefined
  /** `?error=` — an action elsewhere that failed and sent the desk back here. */
  error?: string | undefined
}

export async function PatientRecordScreen({
  paths,
  patient,
  done,
  error,
}: PatientRecordScreenProps): Promise<ReactElement> {
  const status = statusDisplay(patient.status)
  const mergedAway = patient.merged_into_patient_id !== null
  const finalised = isFinalised(patient.status)

  /*
   * A record that was merged away or whose registration ended can do nothing further. Both are
   * refused by the API with a sentence of its own; asking first means the desk is told before
   * they open a form and fill it in with a patient waiting, and the API's refusal is still the
   * control if the two ever disagree.
   */
  const actionable = !mergedAway && !finalised

  /*
   * Degrades rather than throws. A consent history that failed to load must not replace the
   * patient's name, phone number and the way back with the framework's error boundary — the
   * receptionist still has a person at the counter and most of what is on this page is still
   * true.
   */
  const history = await attempt(consentHistory(patient.id))
  const latest = history.ok ? latestDecisions(history.value.records) : {}

  return (
    <>
      <PageHeader
        title={`${patient.given_name} ${patient.family_name}`}
        description={
            <>
            Registered{' '}
            {patient.created_at === null ? (
              'at an unrecorded time'
            ) : (
              <DateTime value={patient.created_at} format="date" />
            )}
            .
            </>
        }
        actions={
            <>
          <Badge tone={status.tone}>{status.label}</Badge>
          <Button href={paths.registry} variant="quiet">
            Back to patients
          </Button>
            </>
        }
      />

      <div className="grid">
        {error !== undefined ? (
          <Notice tone="bad" announce title="That did not happen">
            {error}
          </Notice>
        ) : null}

        <Confirmation done={done} paths={paths} patient={patient} />

        {mergedAway ? (
          <Notice tone="warn" icon="users" announce title="This registration was a duplicate">
            <p>
              Its history moved to another record, and everything from here onwards happens
              there. This row is kept so an old link still leads somewhere truthful.
            </p>
            <p style={{ marginTop: 'var(--space-4)' }}>
              <Button href={paths.record(patient.merged_into_patient_id ?? '')}>
                Open the record that survived
              </Button>
            </p>
          </Notice>
        ) : (
          <Notice tone={finalised ? 'neutral' : status.tone === 'good' ? 'info' : 'warn'} icon="shield" title={status.label}>
            {status.meaning}
          </Notice>
        )}

        <div className="grid g-2">
          <section className="card stack" aria-labelledby="details-heading">
            <div className="row between">
              <h2 className="title-sm grow" id="details-heading">
                Details
              </h2>
              {actionable ? (
                <Button href={paths.details(patient.id)} variant="quiet">
                  Correct these
                </Button>
              ) : null}
            </div>

            <dl className="grid" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
              <Detail label="Phone">
                <span className="tnum">{patient.phone}</span>
                {/* See the note at the top of this file: only TRUE is worth saying. */}
                {patient.phone_verified ? (
                  <>
                    {' '}
                    <Badge tone="good">Confirmed from this handset</Badge>
                  </>
                ) : null}
              </Detail>
              <Detail label="Email">{patient.email ?? <Absent>None on file</Absent>}</Detail>
              <Detail label="Date of birth">
                {patient.date_of_birth === null ? (
                  <Absent>Not recorded</Absent>
                ) : (
                  <DateTime value={patient.date_of_birth} format="date" />
                )}
              </Detail>
              <Detail label="Sex">{sexLabel(patient.sex)}</Detail>
              <Detail label="National ID">
                {patient.national_id_number ?? <Absent>Not recorded, and never required</Absent>}
              </Detail>
              <Detail label="Address">
                {patient.address ?? <Absent>Not recorded</Absent>}
                {patient.district === null ? null : <> · {patient.district}</>}
              </Detail>
              <Detail label="Guardian">
                {patient.guardian.name === null ? (
                  <Absent>None on file</Absent>
                ) : (
                  <>
                    {patient.guardian.name}
                    {patient.guardian.relationship === null
                      ? null
                      : ` (${patient.guardian.relationship})`}
                    {patient.guardian.phone === null ? null : (
                      <>
                        {' · '}
                        <span className="tnum">{patient.guardian.phone}</span>
                      </>
                    )}
                  </>
                )}
              </Detail>
            </dl>
          </section>

          <section className="card stack" aria-labelledby="consent-heading">
            <div className="row between">
              <h2 className="title-sm grow" id="consent-heading">
                Consent
              </h2>
              {actionable ? (
                <Button href={paths.consent(patient.id)} variant="primary">
                  Capture consent
                </Button>
              ) : null}
            </div>

            <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
              The patient decides; you record what they decided. A minor’s guardian decides on
              their behalf.
            </p>

            {!history.ok ? (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Notice tone="warn">
                  {history.message
                    ?? 'The consent history could not be loaded. Nothing here has changed — open the consent screen to see the record itself.'}
                </Notice>
              </div>
            ) : (
              <dl className="grid" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
                {(['data_processing', 'telemedicine', 'delivery_disclosure'] as const).map((type) => {
                  const record = latest[type]
                  const display = consentDisplay(type)

                  return (
                    <Detail key={type} label={display.label}>
                      {record === undefined ? (
                        <Absent>Never asked</Absent>
                      ) : (
                        <>
                          <Badge tone={actionDisplay(record.action).tone}>
                            {actionDisplay(record.action).label}
                          </Badge>
                          {record.occurred_at === null ? null : (
                            <>
                              {' '}
                              <DateTime value={record.occurred_at} format="date" />
                            </>
                          )}
                          {record.granted_by === 'guardian' ? (
                            <>
                              {' · by '}
                              {record.guardian_name ?? 'a guardian'}
                              {record.guardian_relationship === null
                                ? null
                                : ` (${record.guardian_relationship})`}
                            </>
                          ) : null}
                        </>
                      )}
                    </Detail>
                  )
                })}
              </dl>
            )}
          </section>
        </div>

        <AccountCard patient={patient} paths={paths} actionable={actionable} />

        {actionable ? (
          <section className="card stack" aria-labelledby="merge-heading">
            <h2 className="title-sm" id="merge-heading">
              Two records for one person
            </h2>
            <p className="muted">
              If this patient was registered twice, fold the duplicate into this record. The
              duplicate’s appointments, consultations, prescriptions, dispense orders and
              consent history move here; the duplicate itself is kept, pointing at this record,
              so an old link still works. It is audited, it happens within this clinic only, and
              there is no way back.
            </p>
            <div className="row-wrap" style={{ marginTop: 'var(--space-4)' }}>
              <Button href={paths.merge(patient.id)} variant="quiet">
                <Icon name="users" /> Merge a duplicate into this record
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}

/**
 * The portal account, and the three different things this card has to be able to say.
 *
 * SEPARATED OUT BECAUSE THE REFUSALS MATTER MORE THAN THE ACTION. Issuing an account is one
 * button; explaining why it is not offered is where a desk either understands the product or
 * starts inventing workarounds — inventing a placeholder email address to get past a form is
 * exactly the workaround this card exists to prevent, and it would create an account nobody
 * can ever sign into.
 */
function AccountCard({
  patient,
  paths,
  actionable,
}: {
  patient: Patient
  paths: PatientsPaths
  actionable: boolean
}): ReactElement {
  return (
    <section className="card stack" aria-labelledby="account-heading">
      <h2 className="title-sm" id="account-heading">
        Portal account
      </h2>

      {patient.has_account ? (
        /*
         * `has_account` is derived and carries neither the account's address nor its
         * identifier — front desk needs to know whether to offer to create one, and nothing
         * more. There is no endpoint that answers anything else about it, deliberately: "does
         * this person have an account here" is a question worth not being able to ask directly.
         */
        <>
          <p className="muted">
            This patient already has an account and signs in with the address the clinic
            already holds.
          </p>
          <Notice tone="info" icon="lock" className="stack">
            If they have lost the password it cannot be given to them again — not here, not by
            an administrator, and not by Carevelo. The password was shown once when the account
            was created and is stored only as a hash.
          </Notice>
        </>
      ) : !actionable ? (
        <p className="muted">
          An account cannot be issued on this record. {statusDisplay(patient.status).meaning}
        </p>
      ) : patient.email === null ? (
        <>
          <p className="muted">
            A patient signs in with an email address, so this record needs one before an account
            can exist. A patient without an address is registered and treated exactly as normal
            — care is never blocked on this. Add the address when they have one.
          </p>
          <Notice tone="warn" icon="mail" className="stack">
            Do not invent an address to get past this. An account created against an address the
            patient does not control is a login nobody can ever sign into, and it permanently
            occupies that address at this clinic.
          </Notice>
          <div className="row-wrap" style={{ marginTop: 'var(--space-4)' }}>
            <Button href={paths.details(patient.id)} variant="quiet">
              <Icon name="mail" /> Add an email address
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            Issued across the desk, with the person and their identity document in front of you.
            The system generates the password and shows it once — you read it to the patient,
            and they must change it the first time they sign in.
          </p>
          <div className="row-wrap" style={{ marginTop: 'var(--space-4)' }}>
            <Button href={paths.account(patient.id)} variant="quiet">
              <Icon name="lock" /> Issue a portal account
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * What the desk just did, confirmed in the words of what to do next.
 *
 * Driven by `?done=`, which carries no patient data — only which of a closed set of actions
 * completed. An unrecognised value renders nothing rather than an empty banner, because a
 * stale bookmark should not produce a confirmation of something that did not happen.
 */
function Confirmation({
  done,
  paths,
  patient,
}: {
  done: string | undefined
  paths: PatientsPaths
  patient: Patient
}): ReactElement | null {
  switch (done) {
    case 'registered':
      return (
        <Notice tone="info" icon="check" announce title="Registered">
          <p>
            The record exists and holds no clinical information yet. While the patient is with
            you, capture their consent — nothing else can proceed until they have agreed.
          </p>
          <p style={{ marginTop: 'var(--space-4)' }}>
            <Button href={paths.consent(patient.id)} variant="primary">
              Capture consent now
            </Button>
          </p>
        </Notice>
      )
    case 'updated':
      return (
        <Notice tone="info" icon="check" announce title="Details corrected">
          Which fields changed was recorded in the audit trail. What they changed to was not.
        </Notice>
      )
    case 'consent':
      return (
        <Notice tone="info" icon="check" announce title="Consent recorded">
          The decision, the wording it was made against and who authored it are on the record.
        </Notice>
      )
    case 'account':
      return (
        <Notice tone="info" icon="check" announce title="Account issued">
          The password was shown once and is not recoverable. If the patient did not write it
          down or memorise it, they will need to be given a different account against a
          different address.
        </Notice>
      )
    case 'merged':
      return (
        <Notice tone="info" icon="check" announce title="Duplicate merged">
          The duplicate’s history moved here. This record’s status was deliberately NOT
          recalculated from the consent history it inherited — check the status above and
          capture consent again if it is still awaiting.
        </Notice>
      )
    default:
      return null
  }
}

/** One labelled fact. A `<dl>` row, so the label and the value are associated for a reader. */
function Detail({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="stack">
      <dt className="field__label">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * A value that is not there.
 *
 * Its own component so an absence never renders as an empty cell. "Not recorded" and a blank
 * look identical on a screen and mean different things to somebody deciding whether to ask the
 * patient a question — and on the NIN in particular the wording has to say that the absence is
 * permitted, or a receptionist will chase a card the patient may not have.
 */
function Absent({ children }: { children: ReactNode }): ReactElement {
  return <span className="muted">{children}</span>
}

/** The contract sends `sex` as a bare string, so an unknown value shows as itself. */
function sexLabel(sex: string | null): ReactNode {
  switch (sex) {
    case null:
      return <Absent>Not recorded</Absent>
    case 'female':
      return 'Female'
    case 'male':
      return 'Male'
    case 'other':
      return 'Other'
    case 'prefer_not_to_say':
      return 'Prefers not to say'
    default:
      return sex
  }
}
