import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Field, Input, Select } from '@carevelo/ui'
import type { RegistrationInput } from '../api/types'

/**
 * The patient's own details, as form controls — written once and used by both the
 * registration screen and the profile screen.
 *
 * WHY THEY ARE SHARED RATHER THAN TYPED OUT TWICE. Every control below mirrors a backend
 * rule: `max:100` on a name, `max:32` on a national ID, `email:rfc`, `before:tomorrow` on a
 * date of birth. Those mirrors exist ONLY to fail fast and kindly — the backend is
 * authoritative and its message is the one shown — but two copies of a mirror drift, and a
 * `maxLength` that disagrees with the server is a form that silently truncates what a
 * patient typed and then submits the truncation. One copy cannot disagree with itself.
 *
 * THEY RESOLVE THEIR OWN STRINGS. Each is an async Server Component and calls
 * `getTranslations` itself, rather than taking two dozen labels as props. The alternative
 * was a strings bundle threaded through every caller, which is the shape that ends with one
 * screen quietly missing a hint because somebody added a field and updated one call site.
 *
 * NO 'use client'. These are plain controls in a form that posts natively: no state, no
 * onChange, no validation that only exists once a bundle has loaded.
 */

/** What a failed submission objected to, as it comes back in the query string. */
export type FieldFault = {
  /** The field the API named, or null when the failure was not about one field. */
  readonly field: string | null
  /** The API's own sentence. Never rewritten here. */
  readonly message: string
}

/**
 * Prefilled values, keyed exactly as the registration body is.
 *
 * Derived from the generated request type rather than listed again, so a field added to the
 * contract is a field this view model already knows about. `null` is what a resource sends
 * for an empty optional; it renders as an empty control.
 */
export type PatientFieldValues = Readonly<Partial<Record<keyof RegistrationInput, string | null>>>

/** The message for one control, or undefined when this control is not the one at fault. */
function faultFor(fault: FieldFault | undefined, name: string): string | undefined {
  return fault !== undefined && fault.field === name ? fault.message : undefined
}

/** `null` from a resource becomes an absent default rather than the string "null". */
function value(values: PatientFieldValues | undefined, name: keyof RegistrationInput): string | undefined {
  return values?.[name] ?? undefined
}

/**
 * Name and phone: the only three things a clinic needs to contact a person about care.
 *
 * `autoComplete` is set on all three and it earns its place here more than on most forms —
 * the patient is on a phone, on mobile data, and every field the browser can fill is a
 * field they do not have to type on a cracked screen.
 */
export async function IdentityFields({
  values,
  fault,
}: {
  values?: PatientFieldValues | undefined
  fault?: FieldFault | undefined
}): Promise<ReactElement> {
  const t = await getTranslations('Patients')

  return (
    <>
      <Field name="given_name" label={t('fields.givenName')} error={faultFor(fault, 'given_name')}>
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={100}
            required
            autoComplete="given-name"
            defaultValue={value(values, 'given_name')}
          />
        )}
      </Field>

      <Field name="family_name" label={t('fields.familyName')} error={faultFor(fault, 'family_name')}>
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={100}
            required
            autoComplete="family-name"
            defaultValue={value(values, 'family_name')}
          />
        )}
      </Field>

      <Field
        name="phone"
        label={t('fields.phone')}
        hint={t('fields.phoneHint')}
        error={faultFor(fault, 'phone')}
      >
        {(control) => (
          /*
           * NO `pattern` ATTRIBUTE, DELIBERATELY. The server accepts a Ugandan number in
           * every form people actually write it — 0772123456, +256 772 123456,
           * (+256) 772-123-456 — and normalises to E.164 at the boundary. A regex here
           * would have to reproduce that tolerance exactly or start rejecting numbers the
           * clinic can call, and a patient blocked by a browser bubble has no error message
           * to act on. `inputMode` still gives them the numeric keypad.
           */
          <Input
            {...control}
            type="tel"
            inputMode="tel"
            required
            autoComplete="tel"
            defaultValue={value(values, 'phone')}
          />
        )}
      </Field>
    </>
  )
}

/**
 * Everything else, and every one of them optional.
 *
 * DATA MINIMISATION IS THE RULE, NOT THE EXCEPTION: "collect only what care requires". Date
 * of birth, sex, email, address and district are optional, and `national_id_number` is
 * optional IN PERPETUITY — requiring a NIN excludes patients, and exclusion is a worse
 * outcome than unverified identity. The hint on that field says so to the patient, because
 * somebody who has been asked for a NIN at every counter in the country will otherwise
 * assume this one is compulsory too and give up when they cannot find the card.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md — data minimisation
 * @see docs/20-domain/identifiers-and-numbering.md
 */
export async function DetailFields({
  values,
  fault,
}: {
  values?: PatientFieldValues | undefined
  fault?: FieldFault | undefined
}): Promise<ReactElement> {
  const t = await getTranslations('Patients')

  /*
   * Today in Kampala, so a mistyped year is caught by the browser before a round trip. The
   * server rule is `before:tomorrow`; this is the same bound expressed in the clinic's own
   * zone, which is the zone every other date in this product is read in.
   */
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date())

  return (
    <>
      <Field
        name="date_of_birth"
        label={t('fields.dateOfBirth')}
        hint={t('fields.dateOfBirthHint')}
        error={faultFor(fault, 'date_of_birth')}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            max={today}
            autoComplete="bday"
            defaultValue={value(values, 'date_of_birth')}
          />
        )}
      </Field>

      <Field name="sex" label={t('fields.sex')} error={faultFor(fault, 'sex')}>
        {(control) => (
          /*
           * A disabled placeholder rather than an empty enabled option, so "not answered"
           * cannot be posted as a value. `prefer_not_to_say` is a real answer and is offered
           * as one: a patient who declined to say and a patient who was never asked are
           * different facts about a medical record.
           */
          <Select {...control} defaultValue={value(values, 'sex') ?? ''}>
            <option value="" disabled>
              {t('fields.sexPlaceholder')}
            </option>
            <option value="female">{t('fields.sexFemale')}</option>
            <option value="male">{t('fields.sexMale')}</option>
            <option value="other">{t('fields.sexOther')}</option>
            <option value="prefer_not_to_say">{t('fields.sexPreferNotToSay')}</option>
          </Select>
        )}
      </Field>

      <Field
        name="email"
        label={t('fields.email')}
        hint={t('fields.emailHint')}
        error={faultFor(fault, 'email')}
      >
        {(control) => (
          <Input
            {...control}
            type="email"
            inputMode="email"
            maxLength={255}
            autoComplete="email"
            defaultValue={value(values, 'email')}
          />
        )}
      </Field>

      <Field
        name="address"
        label={t('fields.address')}
        hint={t('fields.addressHint')}
        error={faultFor(fault, 'address')}
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={255}
            autoComplete="street-address"
            defaultValue={value(values, 'address')}
          />
        )}
      </Field>

      <Field name="district" label={t('fields.district')} error={faultFor(fault, 'district')}>
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={100}
            autoComplete="address-level1"
            defaultValue={value(values, 'district')}
          />
        )}
      </Field>

      <Field
        name="national_id_number"
        label={t('fields.nationalId')}
        hint={t('fields.nationalIdHint')}
        error={faultFor(fault, 'national_id_number')}
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={32}
            defaultValue={value(values, 'national_id_number')}
          />
        )}
      </Field>
    </>
  )
}

/**
 * The guardian's contact details on the RECORD — which is not the same thing as the
 * guardian's consent.
 *
 * These three fields become mandatory the moment the date of birth says the patient is under
 * 18, and the server says so in a sentence written for the person filling the form in. They
 * are recorded AS GIVEN and never as verified: there is no code sent to a guardian's handset
 * and the platform proves nothing about the number. The consent itself is authored
 * separately, on the consent screen, where the guardian names themselves against the
 * decision.
 */
export async function GuardianContactFields({
  values,
  fault,
}: {
  values?: PatientFieldValues | undefined
  fault?: FieldFault | undefined
}): Promise<ReactElement> {
  const t = await getTranslations('Patients')

  return (
    <>
      <Field
        name="guardian_name"
        label={t('fields.guardianName')}
        error={faultFor(fault, 'guardian_name')}
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={200}
            defaultValue={value(values, 'guardian_name')}
          />
        )}
      </Field>

      <Field
        name="guardian_phone"
        label={t('fields.guardianPhone')}
        error={faultFor(fault, 'guardian_phone')}
      >
        {(control) => (
          <Input
            {...control}
            type="tel"
            inputMode="tel"
            defaultValue={value(values, 'guardian_phone')}
          />
        )}
      </Field>

      <Field
        name="guardian_relationship"
        label={t('fields.guardianRelationship')}
        hint={t('fields.guardianRelationshipHint')}
        error={faultFor(fault, 'guardian_relationship')}
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={60}
            defaultValue={value(values, 'guardian_relationship')}
          />
        )}
      </Field>
    </>
  )
}
