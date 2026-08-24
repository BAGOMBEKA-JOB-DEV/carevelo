import { ApiError } from '@carevelo/api-client'
import { apiClient, write, type Outcome } from './http'
import type { ConsentGrantedBy, ConsentPolicy, ConsentRecord, ConsentType } from './types'

/**
 * Consent: reading the policy, recording a decision, and reading the history back.
 *
 * THE COMPLIANCE CONTROLS LIVE IN THE SHAPE OF THESE CALLS, not in the components that use
 * them. Three of them, each from DPPA 2019 by way of the H2 PRD:
 *
 *   1. ONE DECISION PER CALL. `recordConsent` takes a single `consent_type` and there is no
 *      array anywhere in this file. Consent must be specific, and a bundle is not specific
 *      — so bundling is not merely discouraged here, it is unexpressible.
 *   2. `affirmed` IS REQUIRED AND HAS NO DEFAULT. A default is the absence of an
 *      affirmative action, and the absence of an affirmative action is not consent. The
 *      parameter is non-optional for exactly that reason.
 *   3. THE POLICY VERSION TRAVELS WITH THE DECISION. The API refuses a version it is no
 *      longer serving, because a client that displayed stale wording collected agreement to
 *      text nobody can reproduce — which fails the statute's "demonstrable" test outright.
 *      So the version is taken from the policy that was RENDERED, never from a constant.
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
 * PUBLIC BY NECESSITY, and this is the one call in the domain that works for a stranger: a
 * person must be able to read what they are being asked to agree to BEFORE they have an
 * account. The endpoint carries no patient data at all — a version, a hash, the list of
 * consents this clinic collects, and the prose — so making it readable to anyone discloses
 * nothing about anybody.
 *
 * Throws on failure rather than returning an outcome. There is no partial consent screen: a
 * page that cannot fetch the policy must not render a consent form with the text missing,
 * and letting this propagate is what makes that impossible to get wrong by accident.
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
 * cheap insurance on the highest-stakes screen in the product: a consent form rendered from
 * a half-parsed policy is a consent form showing the patient less than they agreed to.
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
 * list that quietly hid the grant would be a list that cannot answer the only question this
 * endpoint exists for: what did this person agree to, and when.
 *
 * CURSOR PAGINATION, never offset. Decisions are being written while a patient reads —
 * their own, or a staff member's at the desk on their behalf — and an offset under exactly
 * that traffic duplicates and skips rows.
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
    // `undefined` is dropped by the client rather than sent as the string "undefined".
    query: { cursor },
  })

  return { records: response.data, nextCursor: response.meta.next_cursor }
}

/**
 * The same read, answering null instead of throwing when the record is not the caller's.
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
  readonly grantedBy?: ConsentGrantedBy | undefined
  readonly guardianName?: string | undefined
  readonly guardianRelationship?: string | undefined
}

/**
 * Record one consent decision. Both outcomes are recorded — a decline is evidence too.
 *
 * It is what proves the clinic stopped, and it is what a regulator asks for when a patient
 * says they never agreed. So there is no "just don't send it" path in this domain: every
 * press of a button on the consent screen reaches here.
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
   * `guardian_name` is `required_if:granted_by,guardian` — so posting an explicit
   * `undefined`, or a guardian name with no `granted_by`, is a 422 rather than a field the
   * API ignores.
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
 * withdrawal inherits the version and text hash of the GRANT it revokes, because that is
 * the wording the patient is walking back. Pinning today's wording instead would rewrite
 * history — the record would claim they withdrew from text they may never have seen.
 *
 * WHAT THE CALLER MUST NOT PROMISE. Withdrawing halts new processing. It does not delete a
 * medical record the clinic may be legally obliged to retain, and the wording around this
 * call says so plainly. A promise of erasure we cannot keep is worse than an honest
 * explanation of a real tension.
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
 * WHY THE SCREEN NEEDS THIS. Two rules the API enforces have to be legible in the UI before
 * a patient presses anything: a `telemedicine` grant is refused outright until
 * `data_processing` has been granted, and a decision already made should not be asked for
 * again as though it had not been. Deriving both from the history means the screen agrees
 * with the server because it is reading the server's own record, rather than because
 * somebody kept two rule sets in step.
 *
 * Pure, and it takes the ordering as a precondition rather than re-sorting: `occurred_at`
 * is nullable in the contract, and a sort on a null timestamp would silently reorder
 * evidence. The API orders by `occurred_at` then `id`, both descending.
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
