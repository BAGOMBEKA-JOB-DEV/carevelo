import { ApiError } from '@carevelo/api-client'
import { apiClient, write, type Outcome } from './http'
import type { ConsentGrantedBy, ConsentPolicy, ConsentRecord, ConsentType } from './types'

/**
 * Consent at the registration desk: reading the policy, recording what the patient decided,
 * and reading the history back.
 *
 * ------------------------------------------------------------
 * WHO IS ACTING, WHICH IS THE WHOLE DESIGN OF THIS FILE.
 *
 * `docs/50-security-compliance/rbac-matrix.md` gives "Consent — grant / withdraw" a tick in
 * the `patient` column and a dash in every single staff column, including `clinic_admin`. The
 * endpoint these functions call is nevertheless authorised by `PatientPolicy::update`, which
 * admits administrator, clinician and front desk — and that is not a contradiction, it is the
 * sentence printed under the matrix: "Consent is granted by the patient or guardian only.
 * Staff may facilitate in person, but the record names who attested."
 *
 * So the staff member operating this screen is a SCRIBE. They are not exercising a permission
 * to consent; they are writing down a decision somebody else made in front of them. Two
 * things follow, and both are enforced by the shape of the calls below rather than by a note
 * in a component:
 *
 *   - `granted_by` is `patient` or `guardian`. There is no third value in the contract and
 *     none is invented here. Nothing this domain can post attributes a consent decision to
 *     the member of staff who typed it.
 *   - Every decision is audited with the acting staff user as the actor, alongside
 *     `granted_by`. That pairing — who decided, who wrote it down — is the record the
 *     matrix's sentence promises.
 *
 * ------------------------------------------------------------
 * THE COMPLIANCE CONTROLS LIVE IN THE SHAPE OF THESE CALLS, not in the screens that use
 * them. Three of them, each from DPPA 2019 by way of the H2 PRD:
 *
 *   1. ONE DECISION PER CALL. `recordConsent` takes a single `consent_type` and there is no
 *      array anywhere in this file. Consent must be SPECIFIC, and a bundle is not specific —
 *      so bundling is not merely discouraged here, it is unexpressible.
 *   2. `affirmed` IS REQUIRED AND HAS NO DEFAULT. A default is the absence of an affirmative
 *      action, and the absence of an affirmative action is not consent. The parameter is
 *      non-optional for exactly that reason, and the screen has two buttons rather than a
 *      pre-ticked box.
 *   3. THE POLICY VERSION TRAVELS WITH THE DECISION. The API refuses a version it is no
 *      longer serving, because a client that displayed stale wording collected agreement to
 *      text nobody can reproduce — which fails the statute's "demonstrable" test outright. So
 *      the version comes from the policy that was RENDERED on the screen the patient read,
 *      never from a constant.
 *
 * A WITHDRAWAL IS A NEW RECORD AND NEVER AN EDIT, which is why `withdrawConsent` returns a
 * `ConsentRecord` like every other decision rather than a success flag. A consent history
 * that can be edited proves nothing at all.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

/**
 * The clinic's current consent policy, in every language it exists in.
 *
 * BOTH LANGUAGES COME BACK TOGETHER AND THE DESK NEEDS BOTH. The backend's own note on the
 * policy text is unambiguous: "Consent obtained from wording the patient did not understand
 * is not consent." The console's chrome is English because only the patient portal is
 * required to be bilingual — but this document is not chrome, it is the thing the patient is
 * being asked to agree to, and it is shown in the language they can read.
 *
 * Throws on failure rather than returning an outcome. There is no partial consent screen: a
 * page that cannot fetch the policy must not render a consent form with the text missing, and
 * letting this propagate is what makes that impossible to get wrong by accident.
 */
export async function currentConsentPolicy(): Promise<ConsentPolicy> {
  const client = await apiClient()
  const response = await client.get<{ data: unknown }>('/v1/consent-policies/current')

  return normalisePolicy(response.data)
}

/**
 * The payload, checked at the boundary rather than trusted.
 *
 * The generated type for this endpoint is wrong — see types.ts — so there is no compiler
 * guarantee about what arrives here, and this is the one place that gap is closed. It is
 * cheap insurance on the highest-stakes screen in the product: a consent form rendered from a
 * half-parsed policy is a consent form showing the patient less than they agreed to.
 */
function normalisePolicy(data: unknown): ConsentPolicy {
  const payload = (data ?? {}) as Record<string, unknown>

  const text: Record<string, string> = {}

  if (payload.text !== null && typeof payload.text === 'object') {
    for (const [language, prose] of Object.entries(payload.text as Record<string, unknown>)) {
      if (typeof prose === 'string' && prose.trim() !== '') {
        text[language] = prose
      }
    }
  }

  return {
    version: typeof payload.version === 'string' ? payload.version : '',
    text_hash: typeof payload.text_hash === 'string' ? payload.text_hash : '',
    consent_types: Array.isArray(payload.consent_types)
      ? (payload.consent_types.filter((value) => typeof value === 'string') as ConsentType[])
      : [],
    text,
  }
}

/** One page of a patient's consent history, newest decision first. */
export type ConsentHistoryPage = {
  readonly records: readonly ConsentRecord[]
  /** Pass back as `cursor` for the next page. Null when there is no more. */
  readonly nextCursor: string | null
}

/**
 * The full consent history for one patient — grants, declines and withdrawals alike.
 *
 * HISTORY, NOT CURRENT STATE. The sequence of decisions IS the evidence, so a superseded
 * grant is returned alongside the withdrawal that revoked it and the screen shows both. A
 * list that quietly hid the grant could not answer the only question this endpoint exists
 * for: what did this person agree to, when, and to which wording.
 *
 * CURSOR PAGINATION, never offset. Decisions are being written while this is read.
 */
export async function consentHistory(
  patientId: string,
  cursor?: string | undefined,
): Promise<ConsentHistoryPage> {
  const client = await apiClient()

  const response = await client.get<{
    data: ConsentRecord[]
    meta: { next_cursor: string | null }
  }>(`/v1/patients/${encodeURIComponent(patientId)}/consents`, {
    query: { cursor },
  })

  return { records: response.data, nextCursor: response.meta.next_cursor }
}

/**
 * The same read, answering null instead of throwing when the record is not this clinic's.
 *
 * A CROSS-TENANT OR UNAUTHORISED RECORD IS A 404 AND MUST STAY ONE. The API deliberately
 * refuses to distinguish "no such patient" from "a patient of another clinic", because the
 * fact that a named person is a patient of a named clinic is special-category data. Nothing
 * here may recover that distinction — both collapse to null and the route renders its own
 * not-found.
 */
export async function tryConsentHistory(
  patientId: string,
  cursor?: string | undefined,
): Promise<ConsentHistoryPage | null> {
  try {
    return await consentHistory(patientId, cursor)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null
    }

    throw error
  }
}

export type ConsentDecision = {
  readonly patientId: string
  readonly consentType: ConsentType
  /** No default. The absence of an affirmative action is not consent. */
  readonly affirmed: boolean
  /** From the policy that was RENDERED to this patient, never from a constant. */
  readonly policyVersion: string
  /** `patient` or `guardian`. Never the member of staff writing it down. */
  readonly grantedBy?: ConsentGrantedBy | undefined
  readonly guardianName?: string | undefined
  readonly guardianRelationship?: string | undefined
}

/**
 * Record one consent decision. Both outcomes are recorded — a decline is evidence too.
 *
 * A decline is what proves the clinic stopped, and it is what a regulator asks for when a
 * patient says they never agreed. So there is no "just don't send it" path in this domain:
 * every press of a button on the consent screen reaches here, including the one that ends the
 * registration.
 */
export async function recordConsent(
  decision: ConsentDecision,
): Promise<Outcome<{ data: ConsentRecord }>> {
  const body: Record<string, unknown> = {
    consent_type: decision.consentType,
    affirmed: decision.affirmed,
    policy_version: decision.policyVersion,
  }

  /*
   * Sent only when there is something to say. `RejectsUnknownFields` is on this request and
   * `guardian_name` is `required_if:granted_by,guardian` — so posting an explicit `undefined`,
   * or a guardian name with no `granted_by`, is a 422 rather than a field the API ignores.
   */
  if (decision.grantedBy !== undefined) {
    body.granted_by = decision.grantedBy
  }

  if (decision.guardianName !== undefined && decision.guardianName !== '') {
    body.guardian_name = decision.guardianName
  }

  if (decision.guardianRelationship !== undefined && decision.guardianRelationship !== '') {
    body.guardian_relationship = decision.guardianRelationship
  }

  return write<{ data: ConsentRecord }>(
    'POST',
    `/v1/patients/${encodeURIComponent(decision.patientId)}/consents`,
    body,
  )
}

/**
 * Withdraw a consent previously granted.
 *
 * NO POLICY VERSION GOES UP, and that is the API's rule rather than an omission here: a
 * withdrawal inherits the version and text hash of the GRANT it revokes, because that is the
 * wording the patient is walking back. Pinning today's wording instead would rewrite history
 * — the record would claim they withdrew from text they may never have seen.
 *
 * WHAT THE CALLER MUST NOT PROMISE. Withdrawing halts NEW processing. It does not delete a
 * medical record the clinic may be legally obliged to retain, and every word of copy around
 * this call says so plainly. A promise of erasure nobody can keep is worse than an honest
 * explanation of a real tension — and at a desk it is worse still, because the person making
 * the promise is standing in front of the patient.
 *
 * @see docs/50-security-compliance/data-retention-and-deletion.md
 */
export async function withdrawConsent(
  patientId: string,
  consentType: ConsentType,
): Promise<Outcome<{ data: ConsentRecord }>> {
  return write<{ data: ConsentRecord }>(
    'POST',
    `/v1/patients/${encodeURIComponent(patientId)}/consents/withdraw`,
    { consent_type: consentType },
  )
}

/**
 * The most recent decision of each type, from a history that is ordered newest first.
 *
 * WHY THE SCREEN NEEDS THIS. Two rules the API enforces have to be legible before anybody
 * presses anything, because the patient is at the counter and a 422 that could have been
 * predicted wastes their visit: a `telemedicine` grant is refused outright until
 * `data_processing` has been granted, and a decision already made should not be asked for
 * again as though it had not been. Deriving both from the history means the screen agrees
 * with the server because it is reading the server's own record, rather than because somebody
 * kept two rule sets in step.
 *
 * Pure, and it takes the ordering as a precondition rather than re-sorting: `occurred_at` is
 * nullable in the contract, and a sort on a null timestamp would silently reorder evidence.
 * The API orders by `occurred_at` then `id`, both descending.
 */
export function latestDecisions(
  records: readonly ConsentRecord[],
): Readonly<Record<string, ConsentRecord>> {
  const latest: Record<string, ConsentRecord> = {}

  for (const record of records) {
    latest[record.consent_type] ??= record
  }

  return latest
}
