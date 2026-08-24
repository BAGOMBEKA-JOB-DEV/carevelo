import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import { Button, Notice, PageHeader } from '@carevelo/ui'
import { registerPatient } from '../api/patients'
import type { RegistrationInput, Sex } from '../api/types'
import type { PatientsPaths } from '../model/paths'
import {
  DetailFields,
  GuardianContactFields,
  IdentityFields,
  type FieldFault,
} from './PatientFields'

/**
 * Registering a walk-in at the desk.
 *
 * ------------------------------------------------------------
 * WHAT THIS CREATES, AND WHAT IT DOES NOT.
 *
 * It creates a RECORD — the thing a clinic can treat against — in `pending_consent`, which
 * may carry NO clinical data at all until a consent decision moves it on. That constraint is
 * enforced in the database rather than by this screen, which is exactly why the screen has to
 * make it obvious: a receptionist who cannot see why a note will not save will find a way
 * around the product. So the confirmation on the record screen leads straight to consent.
 *
 * It does NOT create an account, and it does not send anything. No SMS, no email, no
 * credential. The login that lets a patient read their own record is a separate, deliberate
 * act with the person and their ID document across the counter — see `IssueAccountScreen`.
 *
 * ------------------------------------------------------------
 * SUBMITTING A NUMBER ALREADY ON FILE OPENS THAT PATIENT, and the form says so before it is
 * submitted rather than after.
 *
 * `PatientController::store` looks the phone up first and returns the EXISTING record with the
 * same 201 and the same body. There is no "already registered" response to branch on and this
 * screen must not manufacture one: telling the desk that a number is taken would confirm that
 * a specific person is a patient of this specific clinic, which is itself special-category
 * disclosure under the DPPA 2019. What the desk sees instead is the record — which is what
 * they wanted anyway, and is today the only reliable way to find somebody by number.
 *
 * ------------------------------------------------------------
 * WHY A FAILED SUBMISSION DOES NOT KEEP WHAT WAS TYPED.
 *
 * This form posts natively so it works before the JavaScript bundle arrives, which means the
 * only ways to carry state across a failure are the URL and a cookie. The URL would put a
 * patient's name, phone number and date of birth into browser history on a SHARED front-desk
 * terminal and into every access log in front of the console; a cookie would put them on the
 * wire with every subsequent request for as long as it lived. Neither is acceptable for a
 * form whose required part is three fields, and the browser's own Back still holds the
 * values. The API's sentence and the field it named DO travel back, because neither carries
 * anything that was typed.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

type RegistrationRoutes = {
  /** This screen's own path, for a failed submission to come back to. */
  readonly returnHref: string
  /** Where a successful registration goes: the record it just created or found. */
  readonly record: (patientId: string) => string
}

async function submitRegistration(
  routes: RegistrationRoutes,
  formData: FormData,
): Promise<void> {
  'use server'

  const text = (name: string): string => String(formData.get(name) ?? '').trim()

  /*
   * Assembled by name rather than spread from the form, so a control added to the markup
   * cannot post a field the contract has no place for. `RejectsUnknownFields` is on this
   * request: an extra key is a 422, not a value the API quietly drops.
   *
   * Empty strings are pruned inside `registerPatient()`, which is where the reasoning lives —
   * a native form posts every control it contains, and `email: ""` fails `email:rfc` for a
   * field the desk was told was optional.
   */
  const input: RegistrationInput = {
    given_name: text('given_name'),
    family_name: text('family_name'),
    phone: text('phone'),
    email: text('email'),
    date_of_birth: text('date_of_birth'),
    /*
     * Cast to `Sex | null` rather than to `RegistrationInput['sex']`, which also admits
     * `undefined` because the property is optional — and under exactOptionalPropertyTypes an
     * explicit `undefined` in this literal is not the same thing as an absent key. The empty
     * string a native form posts for an untouched <select> becomes `null` here; see `prune()`
     * for what happens to it next.
     */
    sex: (text('sex') || null) as Sex | null,
    national_id_number: text('national_id_number'),
    address: text('address'),
    district: text('district'),
    guardian_name: text('guardian_name'),
    guardian_phone: text('guardian_phone'),
    guardian_relationship: text('guardian_relationship'),
  }

  const result = await registerPatient(input)

  if (!result.ok) {
    /*
     * THE API'S OWN SENTENCE AND THE FIELD IT NAMED. Both are the API's — "Enter a valid
     * Ugandan phone number", "A patient under 18 must have a guardian on the record" — written
     * where the rule lives. A second copy here would be free to disagree with the rule it
     * describes, and the desk would be reading the copy.
     */
    const query = new URLSearchParams({ error: result.message })

    if (result.field !== null) {
      query.set('field', result.field)
    }

    redirect(`${routes.returnHref}?${query.toString()}`)
  }

  /*
   * `?done=registered` rather than the record screen guessing. A record reached from a fresh
   * registration needs a different first sentence from one reached out of the registry: the
   * next thing to do is consent, and the patient is still standing there.
   */
  redirect(`${routes.record(result.data.data.id)}?done=registered`)
}

export type RegisterScreenProps = {
  paths: PatientsPaths
  /** The API's sentence from a failed submission, carried back in the URL. */
  error?: string | undefined
  /** The field the API named, so the message lands on the right control. */
  field?: string | undefined
}

export function RegisterScreen({ paths, error, field }: RegisterScreenProps): ReactElement {
  const fault: FieldFault | undefined =
    error === undefined ? undefined : { field: field ?? null, message: error }

  return (
    <>
      <PageHeader
        title="Register a patient"
        description={
          <>
            Name and a phone number are all that is required. Everything else is optional and
            can be added later.
          </>
        }
        actions={
          <Button href={paths.registry} variant="quiet">
            Back to patients
          </Button>
        }
      />

      <div className="grid">
        {/*
          ONE form-level announcement rather than one per field. A form that fails validation
          usually fails several fields at once, and six live regions firing together is noise
          that buries the first. The per-field text is reached through `aria-describedby` when
          the receptionist arrives at the control that is actually wrong — see Field.tsx.
        */}
        {fault !== undefined && fault.field === null ? (
          <Notice tone="bad" announce title="That registration was not saved">
            {fault.message}
          </Notice>
        ) : null}

        {fault !== undefined && fault.field !== null ? (
          <Notice tone="bad" announce title="Check the details">
            {fault.message}
          </Notice>
        ) : null}

        <Notice tone="info" icon="shield" title="What happens when you save this">
          The record is created awaiting consent and can hold no clinical information until the
          patient has agreed to their information being processed. You will be taken straight
          to their record, where the next step is capturing that consent with them present.
        </Notice>

        <form action={submitRegistration.bind(null, {
          returnHref: paths.register,
          record: paths.record,
        })}
        >
          <div className="grid g-2">
            <section className="card stack" aria-labelledby="identity-heading">
              <h2 className="title-sm" id="identity-heading">
                The patient
              </h2>
              <p className="muted">Required. This is everything the clinic needs to reach them.</p>
              <div className="grid" style={{ gap: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
                <IdentityFields fault={fault} />
              </div>
            </section>

            <section className="card stack" aria-labelledby="detail-heading">
              <h2 className="title-sm" id="detail-heading">
                Optional details
              </h2>
              <p className="muted">
                Collect only what care requires. None of these is a condition of being
                registered or treated.
              </p>
              <div className="grid" style={{ gap: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
                <DetailFields fault={fault} />
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
              Required if the patient is under 18 — the guardian, not the patient, gives
              consent. Also where a next-of-kin number goes when the patient has no phone of
              their own: register against that number with the agreement of both, and handle
              notifications in person rather than sending them to a handset nobody carries.
            </p>
            <div className="grid g-2" style={{ marginTop: 'var(--space-4)' }}>
              <GuardianContactFields fault={fault} />
            </div>
          </section>

          <div className="row-wrap" style={{ marginTop: 'var(--space-7)' }}>
            <Button type="submit" variant="primary">
              Register patient
            </Button>
            <Button href={paths.registry} variant="quiet">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
