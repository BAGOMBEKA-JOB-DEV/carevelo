import { ApiError } from '@carevelo/api-client'
import { apiClient, write, type Outcome } from './http'
import type { Patient, ProfileInput, RegistrationInput } from './types'

/**
 * The patient record: creating one, reading one back, and correcting it.
 *
 * WHAT IS NOT HERE, AND WILL NOT BE. There is no `deletePatient`. Nobody deletes a patient
 * record — the clinic may be legally obliged to retain the medical record, and a row that
 * once carried a consent decision has to stay explicable. Erasure where it is lawful is a
 * controller decision handled through the retention process, on the clinic's own surface.
 *
 * There is no `status` field on either write, either. A patient moves between states
 * through consent decisions, never through a field assignment: a client able to post
 * `active` could register a patient who agreed to nothing, and then attach clinical data to
 * them. The API refuses the field; this domain does not offer it.
 *
 * @see docs/20-domain/state-machines.md
 * @see docs/50-security-compliance/data-retention-and-deletion.md
 */

/**
 * Register a patient. The record is created in `pending_consent` and holds no clinical data.
 *
 * A RECORD, NOT AN ACCOUNT. This creates the thing a clinic can treat against. The login
 * that lets a patient read their own record is a separate act, performed by clinic staff
 * from the record, with the person and their identity document in front of them — see
 * ADR-0011. Nothing in this domain issues a credential and nothing here sends an SMS.
 *
 * `national_id_number` IS OPTIONAL AND STAYS OPTIONAL FOREVER. Requiring a NIN excludes
 * patients, and exclusion is a worse outcome than unverified identity. The field is offered
 * because some patients want it on file; it is never asked for as a condition.
 *
 * ON SUBMITTING TWICE. There is no Idempotency-Key on this endpoint, and it does not need
 * one: the controller looks the phone number up first and returns the EXISTING record, with
 * the same 201 and the same body, rather than creating a second one or saying the number is
 * taken. That last part is deliberate and this client must not undo it — "this phone is
 * already registered" would confirm that a specific person is a patient of this specific
 * clinic, which is special-category disclosure. A patient who taps twice on a stalled
 * connection gets one record and no message about it.
 */
export async function registerPatient(
  input: RegistrationInput,
): Promise<Outcome<{ data: Patient }>> {
  return write<{ data: Patient }>('POST', '/v1/patients', prune(input))
}

/**
 * Correct a patient's own demographics.
 *
 * A PATCH, AND ONLY EVER A PATCH. The route is registered without PUT for a reason that
 * bites hard on this resource: PUT means "replace", so a client omitting a field would
 * blank it, and a patient editing their address would silently erase their date of birth.
 * Sending only what changed is the whole contract.
 *
 * THE MEDICAL RECORD IS NOT TOUCHED BY THIS. Demographics are the patient's own to correct.
 * Clinical records are corrected by addendum and never by overwrite — a medical record that
 * can be silently rewritten is not a medical record — and no endpoint reachable from this
 * domain can do it.
 */
export async function updatePatient(
  patientId: string,
  changes: ProfileInput,
): Promise<Outcome<{ data: Patient }>> {
  return write<{ data: Patient }>(
    'PATCH',
    `/v1/patients/${encodeURIComponent(patientId)}`,
    prune(changes),
  )
}

/**
 * One patient record, or null when the caller may not read it.
 *
 * 404 AND 403 COLLAPSE TO THE SAME ANSWER HERE, ON PURPOSE. A record belonging to another
 * clinic answers 404 rather than 403 precisely so that nobody can learn a record exists by
 * the shape of the refusal, and a frontend that distinguished them would hand that
 * distinction straight back. The route renders its own not-found for either.
 */
export async function tryReadPatient(patientId: string): Promise<Patient | null> {
  const client = await apiClient()

  try {
    const response = await client.get<{ data: Patient }>(
      `/v1/patients/${encodeURIComponent(patientId)}`,
    )

    return response.data
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null
    }

    throw error
  }
}

/**
 * Drop the keys a form left empty, so an untouched optional field is absent rather than "".
 *
 * THIS IS NOT TIDINESS, IT IS THE DIFFERENCE BETWEEN TWO REQUESTS. A native form posts every
 * control it contains, so an optional field nobody typed in arrives as an empty string. Sent
 * on a PATCH, `""` means "set this to empty" and would wipe a district the front desk filled
 * in at the counter; sent on a POST, `email: ""` fails `email:rfc` and rejects a
 * registration for a field the patient was told was optional.
 *
 * `null` SURVIVES, and that distinction is the point. `null` is a caller deliberately
 * clearing a value — the API accepts it on every nullable field — while `undefined` and `""`
 * are "not supplied". Collapsing the three would take away the only way a patient has to
 * remove a detail they no longer want on file, which is a data-protection right rather than
 * a nicety.
 */
function prune<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>
}

/**
 * Whether this date of birth means a guardian must author the consent.
 *
 * UNDER 18, measured the way the backend measures it: `RequiresGuardianForMinors` compares
 * the date of birth to now and asks whether the difference is fewer than 18 years, and
 * `ConsentController` refuses a minor's own tick with "A patient under 18 consents through a
 * guardian." This is the same question asked in the browser so the consent screen can put
 * the guardian's fields on the form BEFORE it is submitted, rather than after a 422.
 *
 * THE API REMAINS THE AUTHORITY, AND THAT IS WHY THIS IS SAFE TO APPROXIMATE. Getting it
 * wrong in one direction shows a guardian fieldset to somebody who did not need one; in the
 * other, it produces the API's own clear refusal. Neither outcome can record an invalid
 * consent, which is the only thing that would be worth being defensive about.
 *
 * A blank or unparseable date is not a minor — exactly as the backend treats it, where a
 * malformed date is the `date` rule's business and not this one's.
 */
export function requiresGuardian(dateOfBirth: string | null | undefined, now = new Date()): boolean {
  if (dateOfBirth === null || dateOfBirth === undefined || dateOfBirth.trim() === '') {
    return false
  }

  const born = new Date(dateOfBirth)

  if (Number.isNaN(born.getTime())) {
    return false
  }

  const eighteenth = new Date(born)
  eighteenth.setUTCFullYear(eighteenth.getUTCFullYear() + 18)

  return eighteenth.getTime() > now.getTime()
}
