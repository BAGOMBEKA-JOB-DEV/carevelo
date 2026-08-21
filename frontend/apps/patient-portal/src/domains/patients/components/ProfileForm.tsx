import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Button, Card, Notice } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { updatePatient } from '../api/patients'
import type { Patient, ProfileInput, Sex } from '../api/types'
import {
  DetailFields,
  GuardianContactFields,
  IdentityFields,
  type FieldFault,
  type PatientFieldValues,
} from './PatientFields'

/**
 * A patient correcting their own details.
 *
 * THIS IS A DATA-PROTECTION RIGHT BEING EXERCISED, not a settings page. The DPPA gives a
 * data subject the right to have inaccurate personal data corrected, and the clinic — as
 * controller — has to be able to answer that. Doing it self-service is the cheapest honest
 * way to answer it, and it is also the safest: a mistyped phone number is how somebody
 * else's appointment details and prescription-ready message reach a stranger.
 *
 * WHAT IT DELIBERATELY CANNOT TOUCH, and the screen says so rather than leaving it implied:
 *
 *   THE MEDICAL RECORD. Clinical records are corrected by addendum and never by overwrite —
 *   "a medical record that can be silently rewritten is not a medical record" — so nothing
 *   reachable from here edits a note, a prescription or a dispensing record. A patient who
 *   believes something clinical is wrong raises it with the clinic, and the clinic adds to
 *   the record rather than replacing what is in it.
 *
 *   THE STATUS. A patient moves between `pending_consent`, `active`, `withdrawn` and
 *   `discarded` through consent decisions, never through a field. The API refuses the field
 *   outright; this form does not offer it.
 *
 * A PATCH, AND ONLY WHAT CHANGED. PUT is not registered on this route for a reason that
 * bites exactly here: it means "replace", so a form omitting a field would blank it, and a
 * patient correcting their address would silently erase their date of birth.
 *
 * AN EMPTIED BOX MEANS "REMOVE THIS", AND ONLY ON THIS SCREEN. The controls arrive holding
 * the values the clinic has, so clearing one is a deliberate act — it posts `null` and the
 * API removes the value. That is the difference between this form and registration, where an
 * untouched optional field also arrives empty and must be treated as "not supplied". The two
 * behaviours are one function apart and the distinction is the patient's right to withdraw a
 * detail they no longer want on file.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md — data-subject rights
 */

type ProfileRoutes = {
  readonly patientId: string
  /** This screen's own path. A save posts and comes straight back to it. */
  readonly returnHref: string
}

async function submitProfile(routes: ProfileRoutes, formData: FormData): Promise<void> {
  'use server'

  const { redirect } = await import('next/navigation')

  const text = (name: string): string => String(formData.get(name) ?? '').trim()

  /**
   * An emptied optional field posts `null`, which the API accepts on every nullable column
   * and reads as "remove this". See the note above about why registration does the opposite.
   */
  const nullable = (name: string): string | null => text(name) || null

  const changes: ProfileInput = {
    /*
     * The three mandatory fields keep their empty string, which `prune()` then drops. A
     * patient cannot blank their own name by clearing the box — the control is `required`,
     * so the browser stops it, and if it ever arrives empty anyway the field is simply not
     * part of the patch rather than being sent as "".
     */
    given_name: text('given_name'),
    family_name: text('family_name'),
    phone: text('phone'),

    email: nullable('email'),
    date_of_birth: nullable('date_of_birth'),
    // `Sex | null` rather than `ProfileInput['sex']`: the latter includes `undefined`
    // because the property is optional, and exactOptionalPropertyTypes distinguishes an
    // explicit `undefined` from an absent key. A cleared <select> means null — remove it.
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
    // The API's own sentence and the field it named — including its refusal to let a minor's
    // guardian details be cleared one field at a time, which is a rule this form has no
    // business restating in different words.
    const query = new URLSearchParams({ error: result.message })

    if (result.field !== null) {
      query.set('field', result.field)
    }

    redirect(`${routes.returnHref}?${query.toString()}`)
  }

  redirect(`${routes.returnHref}?saved=1`)
}

export type ProfileFormProps = {
  tenant: Tenant
  /** The record as the API currently holds it. Every control is prefilled from this. */
  patient: Patient
  returnHref: string
  error?: string | undefined
  errorField?: string | undefined
  /** True on the render immediately after a successful save. */
  saved?: boolean | undefined
}

export async function ProfileForm({
  tenant,
  patient,
  returnHref,
  error,
  errorField,
  saved,
}: ProfileFormProps): Promise<ReactElement> {
  const [t, common] = await Promise.all([
    getTranslations('Patients'),
    getTranslations('Common'),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')

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

  const fault: FieldFault | undefined =
    error === undefined ? undefined : { field: errorField ?? null, message: error }

  return (
    <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
      <div className="grid" style={{ gap: 'var(--space-7)', maxWidth: 640 }}>
        <div className="site-sec-head">
          <span className="site-eyebrow">{t('profile.eyebrow')}</span>
          <h1 className="site-h1">{t('profile.title')}</h1>
          <p className="site-lede">{t('profile.lede', { clinic })}</p>
        </div>

        {saved ? (
          /*
           * Announced, because this arrives on a fresh document after a native post and a
           * patient using a screen reader has no other signal that the save took. `Notice`
           * only announces by default on `bad`, so it is asked for explicitly here.
           */
          <Notice tone="info" icon="check" announce>
            {t('profile.saved')}
          </Notice>
        ) : null}

        {error ? <Notice tone="bad">{error}</Notice> : null}

        <Card as="section" aria-labelledby="profile-heading">
          <h2 className="title" id="profile-heading">
            {t('profile.detailsHeading')}
          </h2>

          <form action={submitProfile.bind(null, { patientId: patient.id, returnHref })}>
            <div className="stack" style={{ gap: 'var(--space-5)', marginTop: 'var(--space-6)' }}>
              <IdentityFields values={values} fault={fault} />
              <DetailFields values={values} fault={fault} />
            </div>

            <div className="stack" style={{ gap: 'var(--space-5)', marginTop: 'var(--space-7)' }}>
              <h3 className="title-sm">{t('profile.guardianHeading')}</h3>
              <p className="subtitle" style={{ fontSize: 13 }}>
                {t('profile.guardianNote')}
              </p>

              <GuardianContactFields values={values} fault={fault} />
            </div>

            <div style={{ marginTop: 'var(--space-8)' }}>
              <Button variant="brand" size="lg" block type="submit">
                {t('profile.save')}
              </Button>
            </div>
          </form>
        </Card>

        {/*
          The boundary, stated to the patient rather than only to us. Somebody who thinks
          this page is where a wrong diagnosis gets fixed needs to be told where it actually
          gets fixed, and told before they assume silence means it was.
        */}
        <Notice tone="neutral" icon="file" title={t('profile.clinicalTitle')}>
          {t('profile.clinicalBody', { clinic })}
        </Notice>
      </div>
    </div>
  )
}
