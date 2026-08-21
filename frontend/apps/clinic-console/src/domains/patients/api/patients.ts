import { ApiError } from '@carevelo/api-client'
import { apiClient, write, type Outcome } from './http'
import type { Patient, PatientStatus, ProfileInput, RegistrationInput } from './types'

/**
 * The registry: listing it, reading one record, registering at the desk, correcting details,
 * and folding a duplicate away.
 *
 * WHAT IS NOT HERE, AND WILL NOT BE. There is no `deletePatient`. Nobody deletes a patient
 * record — `PatientPolicy::delete()` returns `false` for every role including the
 * administrator, the clinic may be legally obliged to retain the medical record, and a row
 * that once carried a consent decision has to stay explicable. Erasure where it is lawful is
 * a controller decision handled through the retention process, not an API action.
 *
 * There is no `status` field on either write either. A patient moves between states through
 * consent decisions, never through a field assignment: a client able to post `active` could
 * register a patient who agreed to nothing and then attach clinical data to them. The API
 * refuses the field; this domain does not offer it.
 *
 * @see backend/app/Http/Controllers/Api/V1/PatientController.php
 * @see docs/20-domain/state-machines.md
 */

/** One page of the registry, in the clinic's own alphabetical order. */
export type PatientsPage = {
  readonly patients: readonly Patient[]
  /** Pass back as `cursor` for the next page. Null when there is no more. */
  readonly nextCursor: string | null
  /** The page before this one. Null on the first page. */
  readonly prevCursor: string | null
}

export type RegistryQuery = {
  readonly status?: PatientStatus | undefined
  readonly cursor?: string | undefined
}

/**
 * The clinic's patient list — everyone this clinic may treat, and nobody else.
 *
 * THERE IS NO CROSS-CLINIC PATIENT SEARCH AND THERE WILL NOT BE ONE. That is not a filter
 * this function declines to pass; row-level security is bound to the database session before
 * the router dispatches, so another clinic's patients are not hidden from this list, they are
 * not in it. The isolation boundary between clinics is absolute.
 *
 * MERGED DUPLICATES ARE ABSENT. `PatientController::index` applies `notMerged()`, because a
 * merged duplicate holds no history any more and listing it invites staff to open the empty
 * half of a person. A duplicate is still reachable by an old link, which is why
 * `merged_into_patient_id` is on the resource and why the record screen renders a signpost
 * rather than an empty page.
 *
 * CURSOR PAGINATION, NEVER OFFSET. Front desk pages through this while walk-in registrations
 * are being created beside them, and an offset under exactly that traffic duplicates and
 * skips rows. A skipped row here is a patient the desk concludes is not registered.
 *
 * THE ONE FILTER THE API OFFERS IS `status`. There is deliberately no `q` parameter to pass:
 * `PatientController::index` allow-lists its query — "Never build a query from arbitrary
 * client input" — and `status` is the whole allow-list. The registry screen says so out loud
 * rather than presenting a search box that quietly searches twenty-five rows.
 */
export async function listPatients(query: RegistryQuery = {}): Promise<PatientsPage> {
  const client = await apiClient()

  const response = await client.get<{
    data: Patient[]
    meta: { next_cursor: string | null; prev_cursor: string | null }
  }>('/v1/patients', {
    // `undefined` is dropped by the client rather than sent as the string "undefined".
    query: { status: query.status, cursor: query.cursor },
  })

  return {
    patients: response.data,
    nextCursor: response.meta.next_cursor,
    prevCursor: response.meta.prev_cursor,
  }
}

/**
 * One patient record, or null when it is not this clinic's to read.
 *
 * 404 AND 403 COLLAPSE TO THE SAME ANSWER HERE, ON PURPOSE. A record belonging to another
 * clinic answers 404 rather than 403 precisely so that nobody can learn a record exists by
 * the shape of the refusal, and a frontend that distinguished them would hand that
 * distinction straight back. The route renders its own not-found for either.
 *
 * NOTE THAT READING IS ITSELF AUDITED. `PatientController::show` writes a `patient.viewed`
 * event every time, because "every time a member of staff opens your record that access is
 * recorded" is a promise the consent policy makes to the patient in writing. Nothing in this
 * domain may call this speculatively — to warm a cache, to check existence, to decide whether
 * to show a link — because each call is a line in a log a patient is entitled to ask about.
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
 * Register a walk-in. The record is created in `pending_consent` and holds no clinical data.
 *
 * A RECORD, NOT AN ACCOUNT. This creates the thing a clinic can treat against. The login that
 * lets the patient read their own record is a separate, deliberate act — see `api/account.ts`.
 *
 * SUBMITTING THE SAME NUMBER TWICE IS HOW THE FRONT DESK FINDS AN EXISTING PATIENT, and that
 * is a real property of this endpoint rather than a happy accident. `PatientController::store`
 * looks the phone number up first and returns the EXISTING record — same 201, same body —
 * rather than creating a second one or saying the number is taken. Saying it was taken would
 * confirm that a specific person is a patient of this specific clinic, which is
 * special-category disclosure under the DPPA 2019. Nothing in this domain may undo that: the
 * registration screen tells the desk that a person already on file will simply be opened, and
 * shows no message distinguishing the two cases.
 *
 * `national_id_number` IS OPTIONAL AND STAYS OPTIONAL FOREVER. Requiring a NIN excludes
 * patients, and exclusion is a worse outcome than unverified identity. The field is offered
 * because some patients want it on file; it is never a condition of being registered.
 */
export async function registerPatient(
  input: RegistrationInput,
): Promise<Outcome<{ data: Patient }>> {
  return write<{ data: Patient }>('POST', '/v1/patients', prune(input))
}

/**
 * Correct a patient's contact and demographic details.
 *
 * A PATCH, AND ONLY EVER A PATCH. The route is registered without PUT for a reason that bites
 * hard on this resource: PUT means "replace", so a client omitting a field would blank it,
 * and a receptionist fixing a misspelt surname would silently erase a date of birth. Sending
 * only what changed is the whole contract.
 *
 * THE MEDICAL RECORD IS NOT TOUCHED BY THIS. Demographics are correctable. Clinical records
 * are corrected by addendum and never by overwrite — a medical record that can be silently
 * rewritten is not a medical record — and no endpoint reachable from this domain can do it.
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
 * Fold a duplicate registration into the record that survives.
 *
 * THE ARGUMENT ORDER IS THE DANGEROUS PART, so it is named after the thing that is kept.
 * `survivorId` goes in the URL and `duplicateId` in the body, exactly as
 * `MergePatientRequest` describes: the survivor is the record the desk already has open, and
 * a caller who confuses the two loses the wrong history in a way no validation could detect.
 * The merge screen therefore shows both records side by side and states which one survives,
 * because this is the one action in the domain with no way back.
 *
 * WITHIN A TENANT ONLY, and that is not enforced here. Row-level security is bound before
 * dispatch, so an identifier from another clinic does not resolve at all — there is no
 * cross-tenant patient identity to merge onto, and adding one would breach the isolation
 * boundary.
 *
 * NOBODY IS DELETED. The duplicate survives, pointing at the winner through
 * `merged_into_patient_id`, so an old link still leads somewhere truthful.
 *
 * THE SURVIVOR'S STATUS IS NOT RECOMPUTED, and the screen must say so. If the duplicate was
 * `active` and the survivor is `pending_consent`, the survivor STAYS `pending_consent` and
 * the desk confirms consent through the consent screen. Silently promoting a record because a
 * different registration once consented is the one failure mode here that ends with clinical
 * data attached to a patient who never agreed to any of it.
 */
export async function mergePatient(
  survivorId: string,
  duplicateId: string,
): Promise<Outcome<{ data: Patient }>> {
  return write<{ data: Patient }>(
    'POST',
    `/v1/patients/${encodeURIComponent(survivorId)}/merge`,
    { duplicate_patient_id: duplicateId },
  )
}

/**
 * Drop the keys a form left empty, so an untouched optional field is absent rather than `""`.
 *
 * THIS IS NOT TIDINESS, IT IS THE DIFFERENCE BETWEEN TWO REQUESTS. A native form posts every
 * control it contains, so an optional field nobody typed in arrives as an empty string. Sent
 * on a PATCH, `""` means "set this to empty" and would wipe a district somebody filled in at
 * the counter last week; sent on a POST, `email: ""` fails `email:rfc` and rejects a
 * registration for a field the patient was told was optional.
 *
 * `null` SURVIVES, and that distinction is the point. `null` is a caller deliberately
 * clearing a value — the API accepts it on every nullable field — while `undefined` and `""`
 * are "not supplied". Collapsing the three would take away the only way there is to remove a
 * detail a patient no longer wants on file, which is a data-protection right rather than a
 * nicety.
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
 * guardian." This is the same question asked here so the consent screen can put the guardian
 * on the form BEFORE it is submitted, rather than after a 422 with the patient still at the
 * counter.
 *
 * THE API REMAINS THE AUTHORITY, AND THAT IS WHY THIS IS SAFE TO APPROXIMATE. Getting it
 * wrong in one direction shows a guardian fieldset to somebody who did not need one; in the
 * other, it produces the API's own clear refusal. Neither outcome can record an invalid
 * consent, which is the only thing worth being defensive about.
 *
 * A blank or unparseable date is not a minor — exactly as the backend treats it, where a
 * malformed date is the `date` rule's business and not this one's.
 */
export function requiresGuardian(
  dateOfBirth: string | null | undefined,
  now = new Date(),
): boolean {
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
