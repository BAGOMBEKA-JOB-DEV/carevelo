import { redirect } from 'next/navigation'
import { Button, Card, Field, Input, Notice } from '@carevelo/ui'
import { attempt, writeFailure } from '../api/http'
import { getClinic, omitBlank, saveClinic } from '../api/clinic'
import type { ClinicChanges, TenantPaths } from '../model/types'
import { AccessNotice } from './AccessNotice'
import { NOT_VERIFIED_BY_CAREVELO, clinicName, samePath, trimmed, withParams } from './screen'

/**
 * Contact details, the legal identity, and the two compliance references.
 *
 * ------------------------------------------------------------------------------
 * THE ATTESTATION IS THE POINT OF THIS SCREEN.
 *
 * §H1.3 and acceptance criterion 4: the references are stored and displayed as UNVERIFIED
 * ATTESTATIONS, "with wording to that effect on screen". Carevelo has no access to the
 * UMDPC or NDA registers, performs no lookup against either, and must never imply that a
 * recorded reference has been checked — that implication would be both false and, if
 * relied upon, harmful. `TenantAdminResource.compliance.verified_by_carevelo` is a
 * hard-coded `false` rather than a column, because a column can be set.
 *
 * So the statement sits ABOVE the fields rather than as small print under them, and it is
 * imported from one place — see `components/screen.ts` — because a compliance claim
 * restated in four components eventually becomes four slightly different claims.
 *
 * ------------------------------------------------------------------------------
 * TWO FORMS, BECAUSE ONE HALF CAN BE READ BACK AND THE OTHER CANNOT.
 *
 * `GET /v1/tenant` returns contact details, so those boxes open with what is stored and an
 * emptied box means "remove this" — an explicit `null` on the wire.
 *
 * It does NOT return the legal name or either compliance reference. There is no endpoint
 * that does; `api/clinic.ts` documents the gap and names the route that would close it.
 * Those boxes therefore open EMPTY even when a reference is recorded, and a blank one is
 * OMITTED from the request rather than sent as null — so submitting the form without
 * touching them leaves what is stored alone. The alternative would be a screen that
 * silently erases a licence reference somebody typed last month and never showed them.
 *
 * The cost of that choice is that a reference cannot be CLEARED from here, and the screen
 * says so out loud rather than leaving an administrator to discover it. Of the two possible
 * mistakes — a reference that needs a support call to delete, and a reference deleted by
 * accident — only one of them loses something the clinic cannot get back from us.
 */

export type ComplianceScreenProps = {
  paths: TenantPaths
  saved?: string | undefined
  problem?: string | undefined
}

export async function ComplianceScreen({ paths, saved, problem }: ComplianceScreenProps) {
  const result = await attempt(getClinic())

  if (!result.ok) {
    return <AccessNotice failure={result} context="this clinic's details" />
  }

  const clinic = result.value
  const contact = clinic.contact
  const name = clinicName(clinic)

  return (
    <div className="grid">
      {problem === undefined ? null : (
        <Notice tone="bad" title="That was not saved" announce>
          {problem}
        </Notice>
      )}

      {saved === undefined ? null : <Notice tone="info">{saved}</Notice>}

      <Card as="section">
        <span className="eyebrow">Contact</span>
        <h2 className="title-sm">How patients reach {name}</h2>
        <p className="muted">
          These appear on the patient portal and on the receipt. The phone number is the one
          patients are told to ring when something cannot be done online — which, in the
          first year, is most things.
        </p>

        <form
          action={saveContact.bind(null, { selfPath: paths.compliance })}
          className="stack"
          style={{ gap: 'var(--space-6)', marginTop: 'var(--space-6)' }}
        >
          <Field
            name="contact_phone"
            label="Clinic phone number"
            hint="A Ugandan number. Patients and Carevelo's own notifications both use it."
          >
            {(control) => (
              <Input
                {...control}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                defaultValue={contact.phone ?? ''}
              />
            )}
          </Field>

          <Field name="contact_email" label="Clinic email address">
            {(control) => (
              <Input
                {...control}
                type="email"
                autoComplete="email"
                maxLength={255}
                defaultValue={contact.email ?? ''}
              />
            )}
          </Field>

          <Field name="physical_address" label="Physical address">
            {(control) => (
              <Input {...control} type="text" maxLength={255} defaultValue={contact.physical_address ?? ''} />
            )}
          </Field>

          <Field name="district" label="District">
            {(control) => (
              <Input {...control} type="text" maxLength={100} defaultValue={contact.district ?? ''} />
            )}
          </Field>

          <div className="row-wrap">
            <Button type="submit" variant="primary">
              Save contact details
            </Button>
            <span className="fine">Clearing a box here removes that detail from the portal.</span>
          </div>
        </form>
      </Card>

      <Card as="section">
        <span className="eyebrow">Compliance</span>
        <h2 className="title-sm">Licence references, recorded as your attestation</h2>

        {/*
         * ABOVE the fields, not below them. Somebody typing a licence number into a health
         * platform reasonably assumes it is being checked; the statement has to arrive
         * before the assumption does. `announce` is off deliberately — this is standing
         * context on every visit, not an alert about something that just happened.
         */}
        <Notice tone="info" title="Carevelo does not verify these" icon="shield">
          <p>{NOT_VERIFIED_BY_CAREVELO}</p>
          <p className="fine">
            They are recorded so this clinic can produce them, and they appear as the clinic&rsquo;s
            own statement wherever they are shown. Keeping them current is the clinic&rsquo;s
            responsibility as the licensed operator.
          </p>
        </Notice>

        <Notice tone="warn" title="These boxes always open empty">
          <p>
            Carevelo has no way to show you what is already recorded here — there is no
            endpoint that reads these three fields back. A box you leave empty is left
            untouched, so saving this form will not erase anything. To CHANGE a value, type
            the new one. To remove one entirely, contact support: this screen cannot do it
            without risking deleting a reference it never showed you.
          </p>
        </Notice>

        <form
          action={saveCompliance.bind(null, { selfPath: paths.compliance })}
          className="stack"
          style={{ gap: 'var(--space-6)', marginTop: 'var(--space-6)' }}
        >
          <Field
            name="legal_name"
            label="Registered legal name"
            hint="The entity on the licence, which is often not the name over the door."
          >
            {(control) => <Input {...control} type="text" maxLength={200} />}
          </Field>

          <Field
            name="umdpc_facility_reference"
            label="UMDPC facility reference"
            hint="The supervising clinician's Uganda Medical and Dental Practitioners Council reference."
          >
            {(control) => <Input {...control} type="text" maxLength={64} spellCheck={false} />}
          </Field>

          <Field
            name="nda_licence_reference"
            label="NDA pharmacy licence reference"
            hint="Required before this clinic dispenses medicines. Not required to hold consultations."
          >
            {(control) => <Input {...control} type="text" maxLength={64} spellCheck={false} />}
          </Field>

          <div>
            <Button type="submit" variant="primary">
              Record these references
            </Button>
          </div>
        </form>
      </Card>

      <Card as="section">
        <span className="eyebrow">Data protection</span>
        <h2 className="title-sm">Who is responsible for the records in here</h2>
        <p className="muted">
          Under the Data Protection and Privacy Act 2019 this clinic is the DATA CONTROLLER
          for every patient record it creates on Carevelo, and Carevelo is the PROCESSOR
          acting on the clinic&rsquo;s instructions. That is not a formality: it means the
          clinic answers a subject-access request or a regulator, and it is why the last
          administrator of a clinic cannot be deactivated — a controller that cannot reach
          its own data cannot answer for it.
        </p>
        <p className="fine">
          The patient consent text and privacy notice are platform-provided and versioned to
          those requirements. A clinic may extend the wording but cannot remove the mandatory
          elements, so there is nothing to configure here and nothing that can be switched
          off by accident.
        </p>
      </Card>
    </div>
  )
}

type SaveContext = { selfPath: string }

/**
 * Contact details, where an empty box means REMOVE IT.
 *
 * Safe here and nowhere else on this screen, because these four fields come back on
 * `GET /v1/tenant`: the box the administrator emptied is a box they could see the contents
 * of. That is the entire difference between this action and the one below it.
 */
async function saveContact(context: SaveContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')

  const changes: ClinicChanges = {
    contact_phone: trimmed(formData, 'contact_phone'),
    contact_email: trimmed(formData, 'contact_email'),
    physical_address: trimmed(formData, 'physical_address'),
    district: trimmed(formData, 'district'),
  }

  let failure: string | null = null

  try {
    await saveClinic(changes)
  } catch (error) {
    failure = writeFailure(error, 'the contact details save')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(withParams(back, { saved: 'Contact details saved.', problem: null }))
}

/**
 * The legal name and the two references, where an empty box means LEAVE IT ALONE.
 *
 * `omitBlank` drops every empty field, and `sometimes` on the backend means an absent key
 * is untouched. A submission with all three boxes empty therefore sends `{}` and changes
 * nothing — which is the correct outcome for an administrator who opened the screen to
 * read the attestation notice and pressed the button out of habit.
 */
async function saveCompliance(context: SaveContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')

  const changes = omitBlank({
    legal_name: trimmed(formData, 'legal_name'),
    umdpc_facility_reference: trimmed(formData, 'umdpc_facility_reference'),
    nda_licence_reference: trimmed(formData, 'nda_licence_reference'),
  })

  if (Object.keys(changes).length === 0) {
    redirect(
      withParams(back, {
        saved: null,
        problem:
          'Nothing was filled in, so nothing was changed. Type a value into a box to record it.',
      }),
    )
  }

  let failure: string | null = null

  try {
    await saveClinic(changes)
  } catch (error) {
    failure = writeFailure(error, 'the compliance references save')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(
    withParams(back, {
      saved:
        'Recorded as this clinic\'s own attestation. Carevelo has not checked it against any register.',
      problem: null,
    }),
  )
}
