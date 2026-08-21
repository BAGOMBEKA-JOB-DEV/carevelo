import type { ReactElement } from 'react'
import { Field, Input, Select } from '@carevelo/ui'
import type { RegistrationInput } from '../api/types'

/**
 * The patient's own details, as form controls — written once and used by both the
 * registration screen and the details screen.
 *
 * WHY THEY ARE SHARED RATHER THAN TYPED OUT TWICE. Every control below mirrors a backend
 * rule: `max:100` on a name, `max:32` on a national ID, `email:rfc`, `before:tomorrow` on a
 * date of birth. Those mirrors exist ONLY to fail fast and kindly — the backend is
 * authoritative and its message is the one shown — but two copies of a mirror drift, and a
 * `maxLength` that disagrees with the server is a form that silently truncates what a
 * receptionist typed and then submits the truncation. One copy cannot disagree with itself.
 *
 * PLAIN ENGLISH STRINGS, NO next-intl. Only the patient portal is required to be bilingual;
 * the staff surfaces are English and adding a translation layer to them would be ceremony
 * around a single locale. The one thing on this surface that IS shown in the patient's own
 * language is the consent policy text, and that comes from the API rather than from a
 * catalogue — see `ConsentPolicyText`.
 *
 * NO 'use client'. These are plain controls in a form that posts natively: no state, no
 * onChange, no validation that only exists once a bundle has loaded. A front desk on a
 * flaky connection can still register a walk-in.
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
export type PatientFieldValues = Readonly<
  Partial<Record<keyof RegistrationInput, string | null>>
>

/** The message for one control, or undefined when this control is not the one at fault. */
function faultFor(fault: FieldFault | undefined, name: string): string | undefined {
  return fault !== undefined && fault.field === name ? fault.message : undefined
}

/** `null` from a resource becomes an absent default rather than the string "null". */
function value(
  values: PatientFieldValues | undefined,
  name: keyof RegistrationInput,
): string | undefined {
  return values?.[name] ?? undefined
}

/**
 * Name and phone: the only three things a clinic needs to contact a person about care.
 *
 * THE PHONE IS MANDATORY AND IT IS ALSO THE DE-DUPLICATION KEY. `PatientController::store`
 * looks it up before creating anything and returns the record that already exists, so a
 * receptionist who types a number already on file opens that patient rather than creating a
 * second one. That is deliberate — "this number is already registered" would confirm that a
 * named person is a patient of this clinic — and the registration screen says what will
 * happen instead of letting the desk discover it.
 */
export function IdentityFields({
  values,
  fault,
}: {
  values?: PatientFieldValues | undefined
  fault?: FieldFault | undefined
}): ReactElement {
  return (
    <>
      <Field name="given_name" label="Given name" error={faultFor(fault, 'given_name')}>
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={100}
            required
            autoComplete="off"
            defaultValue={value(values, 'given_name')}
          />
        )}
      </Field>

      <Field name="family_name" label="Family name" error={faultFor(fault, 'family_name')}>
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={100}
            required
            autoComplete="off"
            defaultValue={value(values, 'family_name')}
          />
        )}
      </Field>

      <Field
        name="phone"
        label="Phone number"
        hint={
          'Any of the usual forms works — 0772 123 456, +256 772 123456. If this number is '
          + 'already on file, you will be taken to that patient’s record and nothing new is '
          + 'created.'
        }
        error={faultFor(fault, 'phone')}
      >
        {(control) => (
          /*
           * NO `pattern` ATTRIBUTE, DELIBERATELY. The server accepts a Ugandan number in every
           * form people actually write it and normalises to E.164 at the boundary. A regex here
           * would have to reproduce that tolerance exactly or start rejecting numbers the clinic
           * can call, and a receptionist blocked by a browser bubble has no error message to act
           * on. `inputMode` still gives a tablet the numeric keypad.
           *
           * `autoComplete="off"` on all three, and that is the opposite of the patient portal's
           * choice for the same fields. There the patient is typing their OWN details on their
           * own handset and every field the browser can fill is a field they do not have to
           * type. Here one shared terminal registers forty different people a day: a browser
           * offering the last patient's surname to the next one is a data-protection incident
           * waiting for a distracted moment.
           */
          <Input
            {...control}
            type="tel"
            inputMode="tel"
            required
            autoComplete="off"
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
 * DATA MINIMISATION IS THE RULE, NOT THE EXCEPTION: collect only what care requires. Date of
 * birth, sex, email, address and district are optional, and `national_id_number` is optional
 * IN PERPETUITY — requiring a NIN excludes patients, and exclusion is a worse outcome than
 * unverified identity. The hint on that field says so, because a receptionist who has been
 * asked for a NIN at every counter in the country will otherwise treat this one as compulsory
 * and turn away somebody who cannot find their card.
 *
 * THE DATE OF BIRTH IS THE FIELD THAT CHANGES WHAT HAPPENS NEXT. Under 18 and the guardian
 * fields below become mandatory, and consent must be authored by the guardian rather than the
 * patient. Its hint says so at the point it is typed rather than after a 422.
 *
 * THE EMAIL ADDRESS IS WHAT AN ACCOUNT IS ISSUED AGAINST. A patient with none is registered
 * and treated exactly as normal — care is never blocked on it — but they cannot be given a
 * portal account until there is one, so the hint explains what the field is for instead of
 * leaving the desk to discover it two screens later.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md — data minimisation
 * @see docs/20-domain/identifiers-and-numbering.md
 */
export function DetailFields({
  values,
  fault,
}: {
  values?: PatientFieldValues | undefined
  fault?: FieldFault | undefined
}): ReactElement {
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
        label="Date of birth"
        hint="Under 18 and a guardian’s details are required, and the guardian gives consent."
        error={faultFor(fault, 'date_of_birth')}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            max={today}
            autoComplete="off"
            defaultValue={value(values, 'date_of_birth')}
          />
        )}
      </Field>

      <Field name="sex" label="Sex" error={faultFor(fault, 'sex')}>
        {(control) => (
          /*
           * A disabled placeholder rather than an empty enabled option, so "not answered"
           * cannot be posted as a value. `prefer_not_to_say` is a real answer and is offered as
           * one: a patient who declined to say and a patient who was never asked are different
           * facts about a medical record.
           */
          <Select {...control} defaultValue={value(values, 'sex') ?? ''}>
            <option value="" disabled>
              Not recorded
            </option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefers not to say</option>
          </Select>
        )}
      </Field>

      <Field
        name="email"
        label="Email address"
        hint="Optional. This is what a portal account would be issued against, if the patient wants one."
        error={faultFor(fault, 'email')}
      >
        {(control) => (
          <Input
            {...control}
            type="email"
            inputMode="email"
            maxLength={255}
            autoComplete="off"
            defaultValue={value(values, 'email')}
          />
        )}
      </Field>

      <Field
        name="address"
        label="Address"
        hint="A sentence and a landmark, the way a rider would be told to find it."
        error={faultFor(fault, 'address')}
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={255}
            autoComplete="off"
            defaultValue={value(values, 'address')}
          />
        )}
      </Field>

      <Field name="district" label="District" error={faultFor(fault, 'district')}>
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={100}
            autoComplete="off"
            defaultValue={value(values, 'district')}
          />
        )}
      </Field>

      <Field
        name="national_id_number"
        label="National ID number"
        hint="Optional, and it always will be. A patient without one is a complete record, not an incomplete one."
        error={faultFor(fault, 'national_id_number')}
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={32}
            autoComplete="off"
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
 * are recorded AS GIVEN and never as verified: nothing is sent to the guardian's handset and
 * the platform proves nothing about the number. The consent itself is authored separately, on
 * the consent screen, where the guardian names themselves against the decision and the member
 * of staff attests that they identified them in person.
 *
 * THEY ARE ALSO THE ANSWER TO "THE PATIENT HAS NO PHONE". A record registered against a
 * next-of-kin number is the documented case, not an edge one, and these are the fields that
 * make it explicable months later.
 */
export function GuardianContactFields({
  values,
  fault,
}: {
  values?: PatientFieldValues | undefined
  fault?: FieldFault | undefined
}): ReactElement {
  return (
    <>
      <Field name="guardian_name" label="Guardian’s name" error={faultFor(fault, 'guardian_name')}>
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={200}
            autoComplete="off"
            defaultValue={value(values, 'guardian_name')}
          />
        )}
      </Field>

      <Field name="guardian_phone" label="Guardian’s phone number" error={faultFor(fault, 'guardian_phone')}>
        {(control) => (
          <Input
            {...control}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            defaultValue={value(values, 'guardian_phone')}
          />
        )}
      </Field>

      <Field
        name="guardian_relationship"
        label="Relationship to the patient"
        hint="Mother, father, aunt, legal guardian — as the guardian describes it."
        error={faultFor(fault, 'guardian_relationship')}
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            maxLength={60}
            autoComplete="off"
            defaultValue={value(values, 'guardian_relationship')}
          />
        )}
      </Field>
    </>
  )
}
