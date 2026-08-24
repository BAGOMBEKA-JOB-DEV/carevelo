import { ApiError } from '@carevelo/api-client'
import { readClient, writeClient } from './http'
import type {
  ClinicianProfile,
  ClinicianProfileChanges,
  NewClinicianProfile,
} from '../model/types'

/**
 * The clinical profile that turns a colleague into a practitioner.
 *
 * ------------------------------------------------------------------------------
 * WHY THIS IS THE MOST IMPORTANT SCREEN IN ONBOARDING, AND THE EASIEST TO SKIP.
 *
 * A staff invitation produces a User in a role. That is an ACCOUNT, not a clinician:
 * `GET /v1/availability` generates slots per Clinician ROW, so a clinic whose colleagues
 * all accepted their invitations and whose hours are published still offers no slots, and
 * with no slots there is nothing to book, no consultation and no prescription. The
 * onboarding checklist's "at least one registered clinician" gate is required for
 * activation and this is the only thing that satisfies it.
 *
 * ------------------------------------------------------------------------------
 * THE ONE INVARIANT: PRESCRIBING CANNOT OUTRUN THE NUMBER BEHIND IT.
 *
 * `can_prescribe = true` with a blank registration number is refused with a 409. The PRD's
 * exception path is the reason both halves exist: a clinician whose registration number is
 * not to hand is SAVED with prescribing off and prompted to complete it later, because a
 * clinic that cannot record a colleague at all until somebody finds a certificate simply
 * does not finish onboarding. So the screen offers both, in that order, and the refusal
 * names the way through.
 *
 * `registration_number` is `present` and not `required` on create for the same reason: the
 * empty value is legitimate, but it must be SAID rather than omitted. Leaving the key out
 * of the payload is how a client discovers weeks later that a number it thought it sent
 * was never stored. `createClinicianProfile` therefore always sends the key.
 *
 * ------------------------------------------------------------------------------
 * WHAT IS RECORDED IS NOT WHAT IS VERIFIED.
 *
 * `ClinicianProfileResource` says it on the field itself: recorded, never verified.
 * Carevelo has no access to the UMDPC, AHPC or Nurses & Midwives registers and performs no
 * lookup against any of them. Any screen rendering `registration_body` or
 * `registration_number` must say so, and showing an attestation as though it were a check
 * would be false and, if relied upon, harmful.
 */

/**
 * The profile this colleague already has, or `null` if they have none.
 *
 * 404 IS NOT AN ERROR HERE, AND IT IS TWO DIFFERENT THINGS. The address
 * `…/users/{user}/clinician` returns 404 when the colleague has no profile yet — the
 * remedy is POST, not permission — and ALSO when the user is not a colleague of this
 * clinic at all, or is a patient account. Both collapse to `null` deliberately: telling
 * the two apart on screen would mean telling an administrator that a given id belongs to
 * somebody at another clinic on Carevelo.
 *
 * A 409 is the third case and does NOT collapse: it means the colleague is in a
 * non-clinical role, and the remedy — change the role first — is something the
 * administrator can act on, so the sentence is allowed to reach them. Registration details
 * on a pharmacist or a receptionist would put them in the clinic's availability, where
 * patients would book them.
 */
export async function getClinicianProfile(userId: string): Promise<ClinicianProfile | null> {
  const client = await readClient()

  try {
    const response = await client.get<{ data: ClinicianProfile }>(
      `/v1/tenant/users/${encodeURIComponent(userId)}/clinician`,
    )

    return response.data
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null
    }

    throw error
  }
}

/** Record a colleague's registration details for the first time. */
export async function createClinicianProfile(
  userId: string,
  profile: NewClinicianProfile,
): Promise<ClinicianProfile> {
  const client = await writeClient()
  const response = await client.post<{ data: ClinicianProfile }>(
    `/v1/tenant/users/${encodeURIComponent(userId)}/clinician`,
    profile,
  )

  return response.data
}

/**
 * Correct or complete a profile.
 *
 * PATCH, so every field is optional — and that is load-bearing rather than idiomatic: a
 * partial update that blanked the registration number because the client omitted it would
 * silently strip a clinician of the right to prescribe. The backend judges the RESULTING
 * state rather than the payload, so an update that only switches prescribing on is checked
 * against the number already stored.
 */
export async function updateClinicianProfile(
  userId: string,
  changes: ClinicianProfileChanges,
): Promise<ClinicianProfile> {
  const client = await writeClient()
  const response = await client.patch<{ data: ClinicianProfile }>(
    `/v1/tenant/users/${encodeURIComponent(userId)}/clinician`,
    changes,
  )

  return response.data
}
