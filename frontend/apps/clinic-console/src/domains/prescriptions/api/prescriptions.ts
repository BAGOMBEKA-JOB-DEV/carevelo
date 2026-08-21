import { ApiError } from '@carevelo/api-client'
import { unstable_rethrow } from 'next/navigation'
import { readingApi, writingApi } from './gateway'
import type { DraftItem } from '../model/items'
import { toBody } from '../model/items'
import type { ClinicianProfile, Prescriber, Prescription, PrescriptionsPage } from '../model/types'

/**
 * Issuing, cancelling and reading prescriptions — and reading back who is doing the issuing.
 *
 * ====================================================================================
 * A PRESCRIPTION IS IMMUTABLE. THERE IS NO UPDATE AND THERE NEVER WILL BE.
 * ====================================================================================
 *
 * `PrescriptionPolicy::update()` returns `false` unconditionally, with the reason written
 * above it: "Nobody edits a prescription. Ever. Not the clinician, not the administrator, not
 * Carevelo. Correction is cancel-and-replace, and this absence is deliberate." `delete()`
 * returns `false` too.
 *
 * So this file exposes an issue, a cancel and two reads. Nothing in this domain's components
 * renders an edit control or a disabled one — the capability does not exist, and a greyed-out
 * pencil would teach a clinician that it does and that somebody merely lacks permission.
 *
 * THE REASON ON A CANCELLATION IS MANDATORY AND THE COPY SAYS WHY. `CancelPrescriptionRequest`:
 * "The document has left the building and may already be on someone's phone. A cancellation
 * with no recorded reason leaves the next reader — the pharmacist, the patient, an auditor —
 * unable to tell a transcription slip from a clinical reversal."
 *
 * @see backend/app/Http/Controllers/Api/V1/PrescriptionController.php
 */

export type IssueOutcome =
  | { kind: 'issued'; prescription: Prescription }
  /**
   * `blocked` is one of the two hard preconditions failing inside `Prescription::issue()`.
   * It arrives as a 409 `IllegalTransition` carrying the API's own sentence, which names which
   * one — and those sentences are better than anything this client could write, so they are
   * passed through rather than replaced.
   */
  | { kind: 'blocked'; message: string }
  | { kind: 'problem'; message: string | null }

/**
 * Issue it.
 *
 * THERE IS NO `clinician_id` IN THE BODY AND THAT IS THE DESIGN. "A prescription is the act of
 * the authenticated clinician; accepting the identity from the body would let one clinician
 * sign in another's name." The console could not send one if it wanted to.
 *
 * NO IDEMPOTENCY KEY. The endpoint stores none, so one would be decoration — and what actually
 * has to stop a double press becoming two prescriptions is the confirmation step in front of
 * it, which is a deliberate human act rather than a retry-safe write. A duplicate that does
 * get through is cancelled with a reason, which is the correction mechanism this product has.
 */
export async function issuePrescription(
  consultationId: string,
  items: readonly DraftItem[],
): Promise<IssueOutcome> {
  try {
    const api = await writingApi()
    const response = await api.post<{ data: Prescription }>(
      '/v1/prescriptions',
      toBody(consultationId, items),
    )

    return { kind: 'issued', prescription: response.data }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { kind: 'blocked', message: error.message }
    }

    return { kind: 'problem', message: sentence(error) }
  }
}

export type CancelOutcome =
  | { kind: 'cancelled'; prescription: Prescription }
  | { kind: 'problem'; message: string | null }

/** Cancel, with a reason that is kept on the record and deliberately out of the audit event. */
export async function cancelPrescription(id: string, reason: string): Promise<CancelOutcome> {
  try {
    const api = await writingApi()
    const response = await api.post<{ data: Prescription }>(
      `/v1/prescriptions/${encodeURIComponent(id)}/cancel`,
      { reason },
    )

    return { kind: 'cancelled', prescription: response.data }
  } catch (error) {
    return { kind: 'problem', message: sentence(error) }
  }
}

/**
 * This patient's prescriptions at this clinic, newest first.
 *
 * FILTERED BY PATIENT AND NOT BY CONSULTATION, because `v1.prescriptions.index` accepts
 * `patient_id` and `status` and nothing else — and `PrescriptionResource` does not publish
 * `consultation_id`, so the rows cannot be narrowed to this encounter after the fact either.
 *
 * What the panel does with that is show the patient's RECENT prescriptions at this clinic and
 * label them as such, rather than claiming they were issued in this consultation. Saying "this
 * consultation" over a list that cannot be filtered to it would be a caption that is sometimes
 * a lie, and a clinician cancelling what they think is today's duplicate could cancel last
 * month's repeat.
 *
 * A `consultation_id` filter, or the field on the resource, fixes it. Handover notes.
 */
export async function listPrescriptions(patientId: string): Promise<Prescription[]> {
  try {
    const api = await readingApi()
    const response = await api.get<PrescriptionsPage>('/v1/prescriptions', {
      query: { patient_id: patientId, per_page: 10 },
    })

    return response.data
  } catch (error) {
    // Never the framework's own control-flow errors — see scheduling/api/gateway.ts.
    unstable_rethrow(error)

    // A history that will not load must not take the prescribing form down with it. The panel
    // renders an empty list rather than an error boundary in the middle of a consultation.
    return []
  }
}

export type DocumentLink =
  | { kind: 'ready'; url: string; expiresAt: string }
  /** The renderer has not finished. 202, and the honest answer is "try again in a moment". */
  | { kind: 'rendering' }
  | { kind: 'problem'; message: string | null }

/**
 * A short-lived signed link to the rendered document.
 *
 * THE AUTHORISATION HAPPENS BEFORE ANY URL EXISTS, and the document never sits at a public or
 * guessable path — this endpoint is the only way to reach one. So the link is fetched at the
 * moment it is needed and never stored, never put in a page that is cached, and never emailed.
 *
 * NOT PREFETCHED ON RENDER, deliberately. Minting a signed URL for every prescription on a
 * screen would create links nobody opened, each one live for its whole expiry window.
 */
export async function documentLink(id: string): Promise<DocumentLink> {
  try {
    const api = await readingApi()
    const response = await api.get<{
      data: { url?: string; expires_at?: string; status?: string }
    }>(`/v1/prescriptions/${encodeURIComponent(id)}/document`)

    if (typeof response.data.url === 'string' && typeof response.data.expires_at === 'string') {
      return { kind: 'ready', url: response.data.url, expiresAt: response.data.expires_at }
    }

    return { kind: 'rendering' }
  } catch (error) {
    unstable_rethrow(error)

    return { kind: 'problem', message: sentence(error) }
  }
}

/**
 * Who is prescribing — name, registration body, registration number — or an honest admission
 * that this console cannot read it.
 *
 * READ THE LONG NOTE ON `Prescriber` IN model/types.ts BEFORE CHANGING THIS. In short: the
 * only endpoint carrying a registration number is administrator-only, because it is also the
 * endpoint that GRANTS the right to prescribe. A clinician reading their own is refused as a
 * side effect. That is a gap in the API, it is written up, and the honest behaviour here is to
 * try and to say plainly when the answer is no.
 *
 * A 404 IS DIFFERENT FROM A 403 HERE, AND THE DIFFERENCE IS SAFE TO ACT ON. A 404 on this
 * route means this user of THIS clinic has no Clinician record — the caller is an
 * administrator who is permitted to know that, since they are the one who would create it.
 * There is no cross-tenant disclosure in the distinction: the route resolves the user inside
 * the administrator's own tenant before it answers.
 */
export async function readPrescriber(userId: string, fallbackName: string): Promise<Prescriber> {
  try {
    const api = await readingApi()
    const response = await api.get<{ data: ClinicianProfile }>(
      `/v1/tenant/users/${encodeURIComponent(userId)}/clinician`,
    )

    return { kind: 'known', profile: response.data }
  } catch (error) {
    unstable_rethrow(error)

    if (error instanceof ApiError && error.status === 404) {
      return { kind: 'none' }
    }

    // 403 — the ordinary case for a clinician reading their own — and anything else. Neither
    // is evidence that this person may not prescribe, so neither blocks.
    return { kind: 'unreadable', name: fallbackName }
  }
}

function sentence(error: unknown): string | null {
  return error instanceof ApiError ? error.message : null
}
