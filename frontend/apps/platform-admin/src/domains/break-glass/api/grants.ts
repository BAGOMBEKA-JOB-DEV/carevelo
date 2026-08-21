import { ApiError } from '@carevelo/api-client'
import { readClient, writeClient } from '@/domains/identity'
import type { BreakGlassProblem, Grant, GrantQuery, GrantRequestBody, GrantsPage } from '../model/types'

/**
 * Requesting a break-glass grant, and reading the register of them.
 *
 * ============================================================
 * THERE IS NO REVOKE FUNCTION HERE BECAUSE THERE IS NO REVOKE ENDPOINT
 * ============================================================
 *
 * The published API has `POST /v1/platform/break-glass` and `GET /v1/platform/break-glass`.
 * That is all of it. Grants EXPIRE — the time box is the control — and nothing in this app
 * can end one early.
 *
 * `BreakGlassGrantResource` carries `revoked_at`, so the concept exists in the model and the
 * state diagram in docs/50-security-compliance/rbac-matrix.md shows a `revoked` state. No
 * endpoint reaches it. This domain therefore reads and renders the field and offers no
 * control that would set it, rather than shipping a button that would 404 or, worse, a
 * button that appears to work.
 *
 * That is worth stating plainly rather than treating as an omission: a revoke control is a
 * genuinely reasonable thing to want during an incident, and its absence is reported as a
 * gap on the screen and in this domain's index.ts.
 *
 * ============================================================
 * THE TENANT ARRIVES IN THE BODY, AND THAT IS THE ONE PLACE IT LEGITIMATELY DOES
 * ============================================================
 *
 * Everywhere else in this API tenancy comes from the host or the session, and a
 * client-supplied tenant is the shape of a cross-tenant read attempt. The contract explains
 * the exception: "a cross-tenant control surface has no host to read it from, and the
 * operator is naming the clinic they are asking about. Authorisation does not depend on it:
 * the policy grants the ABILITY to request, and the grant that results is notified to the
 * named clinic, which is what makes a wrong or malicious value visible rather than useful."
 *
 * So a mistyped tenant id here is not a security hole, it is a notification landing on an
 * innocent clinic — which is exactly why the screen offers a picker of real clinics rather
 * than a box to type a UUID into.
 *
 * @see docs/50-security-compliance/rbac-matrix.md § Break-glass
 */

/**
 * A page of the register.
 *
 * TWO READERS, ONE LIST, and this app is only one of them. The contract: "A platform
 * reviewer asks whether the count is rising... A clinic administrator asks what we read of
 * theirs and when, and the policy narrows the list to their own tenant." Nothing in this
 * function chooses which reader it is; the policy on the API does, from the session.
 */
export async function listGrants(query: GrantQuery = {}): Promise<GrantsPage> {
  const client = await readClient()

  return client.get<GrantsPage>('/v1/platform/break-glass', {
    query: {
      tenant_id: query.tenant_id,
      active: query.active,
      per_page: query.per_page,
      cursor: query.cursor,
    },
  })
}

export type GrantOutcome =
  | { kind: 'granted'; grant: Grant }
  | { kind: 'problem'; problem: BreakGlassProblem; message: string | null }

/**
 * Request a grant.
 *
 * THE GRANT AND THE NOTIFICATION ARE ONE TRANSACTION on the API: "There is no window in
 * which access exists and the controller has not been told." So there is nothing for this
 * function to do afterwards — no second call to make, and no notification for a client to
 * remember to send. What the caller must do is READ `tenant_notified_at` on the result and
 * say what it finds, because a null there means the grant permits nothing.
 *
 * NO IDEMPOTENCY KEY, DELIBERATELY. `ApiClient` would set one and this endpoint stores
 * none, so it would be decoration. A double submission produces two grants, which is the
 * honest outcome: two audit entries, two notifications to the clinic, and a register that
 * shows what actually happened. Silently collapsing them would hide a duplicate from the
 * review that exists to count them.
 */
export async function requestGrant(body: GrantRequestBody): Promise<GrantOutcome> {
  try {
    const client = await writeClient()
    const response = await client.post<{ data: Grant }>('/v1/platform/break-glass', body)

    return { kind: 'granted', grant: response.data }
  } catch (error) {
    return { kind: 'problem', ...diagnose(error) }
  }
}

/**
 * Which of the things that can go wrong went wrong.
 *
 * A 404 HERE MEANS THE CLINIC IS NOT THERE, and it is passed through as itself. That is not
 * the "cross-tenant reads are 404" rule at work — this is Carevelo's own control plane and
 * there is no tenant boundary between the operator and the register — it is simply the
 * answer to naming a clinic that does not exist.
 *
 * A 422 KEEPS THE API'S SENTENCE, ALWAYS. The minimum length on `reason` is the one rule
 * this screen must not restate: the contract calls it "a blunt instrument... here on
 * purpose" and publishes no number. An operator who is told "your reason is too short" by
 * the API can act on it; one told the same by a client-side rule that guessed the number
 * might be being refused for nothing.
 */
function diagnose(error: unknown): { problem: BreakGlassProblem; message: string | null } {
  if (!(error instanceof ApiError)) {
    return { problem: 'failed', message: null }
  }

  if (error.status === 403) {
    return { problem: 'refused', message: error.message }
  }

  if (error.status === 404) {
    return { problem: 'not_found', message: error.message }
  }

  if (error.status === 422) {
    return { problem: 'invalid', message: error.message }
  }

  return { problem: 'failed', message: error.message }
}
