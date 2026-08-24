import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Button, Card, Notice, Stack } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { registerPatient, requiresGuardian } from '../api/patients'
import { rememberRegistration } from '../api/handoff'
import type { RegistrationInput, Sex } from '../api/types'
import {
  DetailFields,
  GuardianContactFields,
  IdentityFields,
  type FieldFault,
} from './PatientFields'
import { PageBody } from '@/components/PageBody'

/**
 * Self-registration on the clinic's own portal.
 *
 * WHAT THIS CREATES, AND WHAT IT DOES NOT. It creates a RECORD — the thing a clinic can
 * treat against — in `pending_consent`, which may carry no clinical data at all until a
 * consent decision moves it on. It does NOT create an account. The login that lets a patient
 * read their own record is issued separately by clinic staff, from the record, with the
 * person in front of them; nothing here mints a credential and nothing here sends an SMS.
 *
 * THREE FIELDS ABOVE THE FOLD, AND THAT IS A DATA-PROTECTION DECISION AS MUCH AS A
 * PERFORMANCE ONE. Given name, family name and phone are all the API requires and all this
 * form asks for by default; everything else sits inside a `<details>` the patient opens if
 * they want to. Two things fall out of that and both matter:
 *
 *   - Data minimisation is the rule — "collect only what care requires" — and a form that
 *     presents nine boxes teaches people to fill nine boxes.
 *   - A rejected submission does not repopulate (see below), so the cost of a retype is
 *     three fields rather than nine. The PRD's target is under two minutes on a mid-range
 *     Android over mobile data, and it has to hold on the second attempt too.
 *
 * WHY A FAILED SUBMISSION DOES NOT KEEP WHAT WAS TYPED. This form posts natively so that it
 * works before the JavaScript bundle arrives, which means the only ways to carry state
 * across the failure are the URL and a cookie. The URL would put a patient's name and phone
 * number into browser history and into every access log in front of the portal; a cookie
 * would put them on the wire with every subsequent request for as long as it lived. Neither
 * is worth it for a three-field form, and the browser's own Back still holds the values.
 * The API's sentence and the field it names DO travel back, because neither carries
 * anything the patient typed.
 *
 * A PLAIN FORM POST. No 'use client', no useState, no onSubmit — the patient this is built
 * for is on variable mobile data, and a registration form that needs JavaScript is a
 * registration that does not happen.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

type RegistrationRoutes = {
  /** This screen's own path, for a failed submission to come back to. */
  readonly returnHref: string
  /** The consent screen. Where a successful registration goes, immediately. */
  readonly consentHref: string
}

async function submitRegistration(
  routes: RegistrationRoutes,
  formData: FormData,
): Promise<void> {
  'use server'

  const { redirect } = await import('next/navigation')

  const text = (name: string): string => String(formData.get(name) ?? '').trim()

  /*
   * Assembled by name rather than spread from the form, so a control added to the markup
   * cannot post a field the contract has no place for. `RejectsUnknownFields` is on this
   * request: an extra key is a 422, not a value the API quietly drops.
   *
   * Empty strings are pruned inside registerPatient(), which is where the reasoning lives —
   * a native form posts every control it contains, and `email: ""` fails `email:rfc` for a
   * field the patient was told was optional.
   */
  const input: RegistrationInput = {
    given_name: text('given_name'),
    family_name: text('family_name'),
    phone: text('phone'),
    email: text('email'),
    date_of_birth: text('date_of_birth'),
    /*
     * Cast to `Sex | null` rather than to `RegistrationInput['sex']`, which also admits
     * `undefined` because the property is optional — and under exactOptionalPropertyTypes
     * an explicit `undefined` in this literal is not the same thing as an absent key. The
     * empty string a native form posts for an untouched <select> becomes `null` here; see
     * prune() for what happens to it next.
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
     * Ugandan phone number, for example 0772 123 456" is written where the rule lives, and
     * a second copy of it here would be free to disagree with the rule it describes.
     *
     * Note what is NOT branched on: there is no "that number is already registered" path,
     * because there is no such response. The controller returns the EXISTING record, with
     * the same status and the same body, rather than confirming that a specific person is a
     * patient of this specific clinic — which would itself be special-category disclosure.
     */
    const query = new URLSearchParams({ error: result.message })

    if (result.field !== null) {
      query.set('field', result.field)
    }

    redirect(`${routes.returnHref}?${query.toString()}`)
  }

  /*
   * AN `else` THAT LOOKS REDUNDANT BESIDE THE `redirect` ABOVE, AND IS NOT. `redirect()`
   * returns `never`, but TypeScript only lets a never-returning CALL end control flow when
   * the callee is a name with an explicit type annotation — and this one is destructured
   * out of a dynamic import, which is inferred. So without the `else` the compiler still
   * believes `result` may be the failure arm, and `result.data` is an error rather than a
   * patient. The dynamic import stays because `next/navigation` at module scope pulls the
   * router into every consumer of this file.
   */
  else {
    const patient = result.data.data

    /*
     * The pointer to the record this browser just created, so the consent screen can find
     * it without the identifier travelling in a URL. See api/handoff.ts for why that
     * distinction is worth a cookie.
     */
    await rememberRegistration({
      patientId: patient.id,
      guardianRequired: requiresGuardian(patient.date_of_birth),
    })

    redirect(routes.consentHref)
  }
}

export type RegistrationFormProps = {
  tenant: Tenant
  returnHref: string
  consentHref: string
  /** The API's sentence from a rejected submission, arriving back in the query string. */
  error?: string | undefined
  /** The field the API named, so the message lands on the right control as well. */
  errorField?: string | undefined
}

export async function RegistrationForm({
  tenant,
  returnHref,
  consentHref,
  error,
  errorField,
}: RegistrationFormProps): Promise<ReactElement> {
  const [t, common] = await Promise.all([
    getTranslations('Patients'),
    getTranslations('Common'),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')

  const fault: FieldFault | undefined =
    error === undefined ? undefined : { field: errorField ?? null, message: error }

  return (
    <PageBody>
      {/* `.site-form` caps the column at 640px. `.site-wrap` is 1280px, which is right for
          a marketing band and wrong for a text input — a `Field` stretched that wide gives
          a patient a 1200px box to type a phone number into. This was
          `style={{ maxWidth: 640 }}` here and on three other screens; it is one class in
          tokens/site.css now, beside the measure it differs from. */}
      <Stack gap="7" className="site-form">
        <div className="site-sec-head">
          <span className="site-eyebrow">{t('register.eyebrow')}</span>
          <h1 className="site-h1">{t('register.title', { clinic })}</h1>
          <p className="site-lede">{t('register.lede', { clinic })}</p>
        </div>

        {error ? (
          /* One alert for the form, at the top, where focus lands after a failed post. The
             per-field copy is reached through aria-describedby; see Field.tsx. */
          <Notice tone="bad">{error}</Notice>
        ) : null}

        <Card as="section" aria-labelledby="register-heading">
          {/* 18px from the card's heading down to the form, stated on the column instead of
              on the form's first child — where it was a `marginTop` that belonged to the
              relationship between two elements rather than to either of them. */}
          <Stack gap="6">
            <h2 className="title" id="register-heading">
              {t('register.aboutYouHeading')}
            </h2>

            <form action={submitRegistration.bind(null, { returnHref, consentHref })}>
              {/*
               * THREE NESTED COLUMNS, AND THE NESTING IS THE FORM'S OWN SHAPE RATHER THAN A
               * TRICK TO REACH THREE DIFFERENT NUMBERS. The distances used to be four
               * `marginTop`s — 24px, 16px, 16px, 30px — spread across four elements, and
               * reading them meant reading all four.
               *
               * Outermost: 30px, which is the gap before the submit button. A form's
               * primary action wants visible air above it, so that the last field and the
               * irreversible tap are not one continuous run of things to touch.
               *
               * Middle: 24px, between what the API requires and what it does not. That gap
               * is the fold in the form and it is deliberately the second-largest.
               *
               * Innermost: 16px, twice — between the required fields, and between the two
               * `<details>`, which are a PAIR (optional details, then guardian details) and
               * are spaced as one.
               */}
              <Stack gap="8">
                <Stack gap="7">
                  <Stack gap="5">
                    <IdentityFields fault={fault} />
                  </Stack>

                  <Stack gap="5">
                    {/*
                      OPTIONAL, AND IT LOOKS OPTIONAL. A `<details>` needs no JavaScript to
                      open, and collapsing these keeps the required part of the form to one
                      screen on a phone. It is opened by default when the failure was in one
                      of them, so a patient is never told something is wrong on a field they
                      cannot see.

                      `.disclosure` and `.disclosure__summary` from the token layer. A
                      `<summary>` is a CONTROL — clicked, tabbed to, toggling state — so it
                      answers to the same 44px touch floor as `.btn`, and the user agent
                      gives it the height of one line of text. That geometry was a `SUMMARY`
                      style constant in this file and a second copy of it in
                      ConsentHistory.tsx; both are gone. `.disclosure` also supplies the
                      column inside the `<details>`, which is the one column a `<Stack>` can
                      never be: `<summary>` must be the first child of `<details>`, and
                      Stack renders a div.
                    */}
                    <details
                      className="disclosure"
                      open={DETAIL_FIELDS.includes(errorField ?? '')}
                    >
                      <summary className="disclosure__summary">{t('register.moreDetails')}</summary>

                      <Stack gap="5">
                        <p className="subtitle subtitle--sm">
                          {t('register.moreDetailsNote', { clinic })}
                        </p>

                        <DetailFields fault={fault} />
                      </Stack>
                    </details>

                    <details
                      className="disclosure"
                      open={GUARDIAN_FIELDS.includes(errorField ?? '')}
                    >
                      <summary className="disclosure__summary">
                        {t('register.guardianSummary')}
                      </summary>

                      <Stack gap="5">
                        <p className="subtitle subtitle--sm">{t('register.guardianNote')}</p>

                        <GuardianContactFields fault={fault} />
                      </Stack>
                    </details>
                  </Stack>
                </Stack>

                <Button variant="brand" size="lg" block type="submit">
                  {t('register.submit')}
                </Button>
              </Stack>
            </form>
          </Stack>
        </Card>

        {/*
          WHAT HAPPENS NEXT, SAID BEFORE IT HAPPENS. The consent screen is the next thing this
          patient sees, and telling them so here is the difference between a considered
          decision and one taken by surprise. It also states the thing that makes registering
          safe to do: nothing about their health is recorded until they have agreed.
        */}
        <Notice tone="neutral" icon="shield" title={t('register.nextTitle')}>
          {t('register.nextBody', { clinic })}
        </Notice>
      </Stack>
    </PageBody>
  )
}

/** Which `<details>` a rejected field lives in, so the right one is open on the way back. */
const DETAIL_FIELDS: readonly string[] = [
  'email',
  'date_of_birth',
  'sex',
  'national_id_number',
  'address',
  'district',
]

const GUARDIAN_FIELDS: readonly string[] = [
  'guardian_name',
  'guardian_phone',
  'guardian_relationship',
]
