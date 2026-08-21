import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import { Button, Notice } from '@carevelo/ui'
import { updatePatient } from '../api/patients'
import type { Patient, ProfileInput, Sex } from '../api/types'
import { isFinalised } from '../model/status'
import type { PatientsPaths } from '../model/paths'
import {
  DetailFields,
  GuardianContactFields,
  IdentityFields,
  type FieldFault,
  type PatientFieldValues,
} from './PatientFields'

/**
 * Correcting a patient's contact and demographic details, at the desk.
 *
 * ------------------------------------------------------------
 * WHAT THIS DELIBERATELY CANNOT TOUCH, and the screen says so rather than leaving it implied.
 *
 *   THE MEDICAL RECORD. Clinical records are corrected by addendum and never by overwrite — a
 *   medical record that can be silently rewritten is not a medical record — so nothing
 *   reachable from here edits a note, a prescription or a dispensing record. Nobody can, in
 *   any role: the RBAC matrix has a dash across the entire row for "Clinical note — delete"
 *   and "Prescription — edit", including the administrator and including Carevelo.
 *
 *   THE STATUS. A patient moves between `pending_consent`, `active`, `withdrawn` and
 *   `discarded` through consent decisions, never through a field assignment. The API refuses
 *   the field outright; this form does not offer it. A status column anything can write is not
 *   a state machine.
 *
 * ------------------------------------------------------------
 * AN EMPTIED BOX MEANS "REMOVE THIS", AND ONLY ON THIS SCREEN.
 *
 * The controls arrive holding the values the clinic already has, so clearing one is a
 * deliberate act — it posts `null` and the API removes the value. That is the opposite of the
 * registration form, where an untouched optional field also arrives empty and must be read as
 * "not supplied". The two behaviours are one helper apart, and the distinction is what lets a
 * patient have a detail taken off their record when they ask for it.
 *
 * A PATCH, NEVER A PUT. PUT means "replace", so a form omitting a field would blank it, and a
 * receptionist fixing a surname would silently erase a date of birth. `PatientController` does
 * not register PUT at all, for exactly this reason.
 *
 * ------------------------------------------------------------
 * WHAT THE AUDIT TRAIL GETS. `patient.updated` records WHICH FIELDS changed and never what
 * they changed to. The confirmation says so, because a receptionist who believes the old value
 * is recoverable from the audit log will not think twice about overwriting something they were
 * unsure of.
 */

type DetailsRoutes = {
  readonly patientId: string
  /** This screen's own path, for a failed submission to come back to. */
  readonly returnHref: string
  /** The record. Where a successful save goes. */
  readonly recordHref: string
}

async function submitDetails(routes: DetailsRoutes, formData: FormData): Promise<void> {
  'use server'

  const text = (name: string): string => String(formData.get(name) ?? '').trim()

  /** An emptied optional field posts `null` — the API reads that as "remove this". */
  const nullable = (name: string): string | null => text(name) || null

  const changes: ProfileInput = {
    /*
     * The three mandatory fields keep their empty string, which `prune()` then drops. Nobody
     * can blank a patient's name by clearing the box — the control is `required`, so the
     * browser stops it, and if it ever arrives empty anyway the field is simply not part of
     * the patch rather than being sent as "".
     */
    given_name: text('given_name'),
    family_name: text('family_name'),
    phone: text('phone'),

    email: nullable('email'),
    date_of_birth: nullable('date_of_birth'),
    // `Sex | null` rather than `ProfileInput['sex']`: the latter includes `undefined` because
    // the property is optional, and exactOptionalPropertyTypes distinguishes an explicit
    // `undefined` from an absent key. A cleared <select> means null — remove it.
    sex: nullable('sex') as Sex | null,
    national_id_number: nullable('national_id_number'),
    address: nullable('address'),
    district: nullable('district'),
    guardian_name: nullable('guardian_name'),
    guardian_phone: nullable('guardian_phone'),
    guardian_relationship: nullable('guardian_relationship'),
  }

  const result = await updatePatient(routes.patientId, changes)

  if (!result.ok) {
    /*
     * The API's own sentence and the field it named — including its refusal to let a minor's
     * guardian details be cleared one field at a time, and its neutral phone message ("This
     * number cannot be used on this record. Check it, or merge the duplicate registration"),
     * which is worded that way so it does not confirm that the number belongs to another
     * patient here. Restating either in different words would be this screen guessing at rules
     * the backend owns.
     */
    const query = new URLSearchParams({ error: result.message })

    if (result.field !== null) {
      query.set('field', result.field)
    }

    redirect(`${routes.returnHref}?${query.toString()}`)
  }

  redirect(`${routes.recordHref}?done=updated`)
}

export type PatientDetailsScreenProps = {
  paths: PatientsPaths
  /** The record as the API currently holds it. Every control is prefilled from this. */
  patient: Patient
  error?: string | undefined
  field?: string | undefined
}

export function PatientDetailsScreen({
  paths,
  patient,
  error,
  field,
}: PatientDetailsScreenProps): ReactElement {
  const fault: FieldFault | undefined =
    error === undefined ? undefined : { field: field ?? null, message: error }

  /*
   * Keyed exactly as the registration body is, so the same controls serve both screens. The
   * guardian block on `PatientResource` is nested and the request body is flat, which is the
   * one place the two shapes genuinely differ; flattening it here is a mapping rather than a
   * second copy of the contract.
   */
  const values: PatientFieldValues = {
    given_name: patient.given_name,
    family_name: patient.family_name,
    phone: patient.phone,
    email: patient.email,
    date_of_birth: patient.date_of_birth,
    sex: patient.sex,
    national_id_number: patient.national_id_number,
    address: patient.address,
    district: patient.district,
    guardian_name: patient.guardian.name,
    guardian_phone: patient.guardian.phone,
    guardian_relationship: patient.guardian.relationship,
  }

  /*
   * A discarded registration cannot be edited — `PatientController::update` throws before it
   * reaches the fields. Rendering a form that cannot be saved would waste a receptionist's
   * time with a patient at the counter, so the screen refuses first and repeats the API's own
   * reasoning rather than inventing its own.
   */
  if (isFinalised(patient.status)) {
    return (
      <>
        <div className="page-head">
          <div className="grow">
            <h1>Details cannot be changed</h1>
            <p>
              {patient.given_name} {patient.family_name}
            </p>
          </div>
          <Button href={paths.record(patient.id)} variant="quiet">
            Back to the record
          </Button>
        </div>

        <Notice tone="warn" icon="shield" title="This registration ended when consent was declined">
          The record is kept only to explain why service could not proceed, and it is purged on
          schedule. It cannot be corrected. If this person now wants to be treated here, register
          them again from the start.
        </Notice>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Correct details</h1>
          <p>
            {patient.given_name} {patient.family_name}
          </p>
        </div>
        <Button href={paths.record(patient.id)} variant="quiet">
          Back to the record
        </Button>
      </div>

      <div className="grid">
        {fault !== undefined ? (
          <Notice tone="bad" announce title="Nothing was saved">
            {fault.message}
          </Notice>
        ) : null}

        <Notice tone="info" icon="shield" title="What this changes, and what it does not">
          Contact and demographic details only. Clinical records are never overwritten — they
          are corrected by an addendum, by the clinician, on the consultation itself. Clearing a
          box removes that detail from the record. The audit trail records which fields you
          changed, and deliberately not what they said before.
        </Notice>

        <form action={submitDetails.bind(null, {
          patientId: patient.id,
          returnHref: paths.details(patient.id),
          recordHref: paths.record(patient.id),
        })}
        >
          <div className="grid g-2">
            <section className="card stack" aria-labelledby="identity-heading">
              <h2 className="title-sm" id="identity-heading">
                The patient
              </h2>
              <div className="grid" style={{ gap: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
                <IdentityFields values={values} fault={fault} />
              </div>
            </section>

            <section className="card stack" aria-labelledby="detail-heading">
              <h2 className="title-sm" id="detail-heading">
                Optional details
              </h2>
              <p className="muted">Clear a box to take that detail off the record.</p>
              <div className="grid" style={{ gap: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
                <DetailFields values={values} fault={fault} />
              </div>
            </section>
          </div>

          <section
            className="card stack"
            aria-labelledby="guardian-heading"
            style={{ marginTop: 'var(--space-6)' }}
          >
            <h2 className="title-sm" id="guardian-heading">
              Guardian
            </h2>
            <p className="muted">
              Required while the patient is under 18. The API checks this against the RESULTING
              record rather than against what you sent, so a guardian’s details cannot be
              removed one field at a time.
            </p>
            <div className="grid g-2" style={{ marginTop: 'var(--space-4)' }}>
              <GuardianContactFields values={values} fault={fault} />
            </div>
          </section>

          <div className="row-wrap" style={{ marginTop: 'var(--space-7)' }}>
            <Button type="submit" variant="primary">
              Save corrections
            </Button>
            <Button href={paths.record(patient.id)} variant="quiet">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
