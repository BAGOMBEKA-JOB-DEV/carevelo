import { ApiError } from '@carevelo/api-client'
import { readClient, writeClient } from './http'
import type { PaymentIntent, Receipt } from './types'

/**
 * The three calls this domain makes against a single payment attempt.
 *
 * THERE IS NO REFUND CALL HERE BECAUSE THERE IS NO REFUND ENDPOINT, and that is a product
 * decision rather than a gap waiting to be filled. The money went to the clinic's own
 * account at the clinic's own aggregator; Carevelo never held it and could not give it back
 * without becoming the kind of business the whole architecture exists to avoid being. The
 * backend states it in the same terms — `PaymentIntentPolicy::refund()` returns `false` with
 * the comment "there is no refund permission, because there is no refund capability".
 * `RefundGuidance.tsx` is what the clinic sees instead of a button.
 *
 * THERE IS ALSO NO LIST CALL, and that is worth stating because its absence shapes the
 * whole section. `GET /v1/payment-intents` does not exist: an attempt is reached by its id,
 * from the appointment or dispense order it was raised against, or from the reconciliation
 * view — which is the clinic administrator's screen alone. A front-desk clerk cannot browse
 * the clinic's payments, by construction.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */

/**
 * One payment attempt, or null.
 *
 * NULL COVERS 404 AND 403 ALIKE, and collapsing them is the point. The API answers a
 * cross-tenant reference with 404 precisely so nobody can discover which clinic holds which
 * record; a console that turned a 403 into a distinguishable screen would hand that
 * distinction straight back. The route renders one not-found page for both.
 *
 * The route decides what to do with null — normally `notFound()`. Doing it here would put a
 * routing decision inside the domain.
 */
export async function getPaymentIntent(id: string): Promise<PaymentIntent | null> {
  try {
    const client = await readClient()
    const response = await client.get<{ data: PaymentIntent }>(
      `/v1/payment-intents/${encodeURIComponent(id)}`,
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
 * The receipt for a succeeded attempt, or null.
 *
 * NULL RATHER THAN A THROW ON ANY API FAILURE. The attempt is the record; the receipt is a
 * rendering of it. A clinic that can see the payment succeeded should still see that when a
 * second call fails — losing the whole screen because the receipt did not load would be a
 * worse answer to "did this patient pay?" than a partial one.
 */
export async function getReceipt(id: string): Promise<Receipt | null> {
  try {
    const client = await readClient()
    const response = await client.get<{ data: Receipt }>(
      `/v1/payment-intents/${encodeURIComponent(id)}/receipt`,
    )

    return response.data
  } catch (error) {
    if (error instanceof ApiError) {
      return null
    }

    throw error
  }
}

export type AttestResult =
  | { readonly ok: true; readonly intent: PaymentIntent }
  | {
      readonly ok: false
      /**
       * Our own classification, so the screen can say something specific without
       * re-inspecting the problem document. `not_found` also covers a 403 on the record
       * itself, for the cross-tenant reason given on `getPaymentIntent`.
       */
      readonly reason: 'forbidden' | 'not_found' | 'already_resolved' | 'not_cash' | 'other'
      /** The API's own sentence, already humanised. Never a raw payload. */
      readonly message: string
    }

/**
 * A named member of staff attests that cash was received at the clinic.
 *
 * WHAT THIS ACTUALLY RECORDS. No aggregator is involved and no money passes through
 * Carevelo — the patient handed notes to a person standing behind a counter. All this
 * writes is that a member of the clinic's staff says so, attributed and audited. That
 * attribution is the whole value of the record and the only fraud control this design has
 * to offer: it is the clinic's own internal control, and the audit trail is what makes it
 * one. The actor is taken from the authenticated session by the backend's `AuditLog`, never
 * from anything this client sends — a self-reported attester is not a control.
 *
 * ONLY CASH. The API refuses any aggregator-backed method outright, and the screen must not
 * offer the control for one. Marking a mobile-money collection succeeded by hand would let
 * a member of staff assert a payment the aggregator never confirmed, turning the clinic's
 * books into fiction and defeating reconciliation, whose entire purpose is to resolve
 * independently of what anyone claims.
 *
 * NO Idempotency-Key IS SENT, AND THAT IS CHECKED RATHER THAN ASSUMED. `store` is the only
 * handler in the API that reads the header; nothing else does, and there is no middleware
 * applying it more broadly. Sending one here would be a header nobody consumes, which reads
 * at a glance like double-submit protection that is not there. The real protection is the
 * state machine: a second attestation of an already-resolved attempt is an illegal
 * transition and comes back 409, so cash cannot be received twice.
 */
export async function attestCash(id: string): Promise<AttestResult> {
  try {
    const client = await writeClient()
    const response = await client.post<{ data: PaymentIntent }>(
      `/v1/payment-intents/${encodeURIComponent(id)}/attest-cash`,
    )

    return { ok: true, intent: response.data }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error
    }

    return { ok: false, reason: classify(error), message: messageFor(error) }
  }
}

/**
 * The sentence to put in front of the person who pressed the button.
 *
 * `humanise()` IS DELIBERATELY BYPASSED FOR 409 AND ONLY FOR 409, and this is a real defect
 * being worked around rather than a preference. The backend renders an illegal transition
 * through `ProblemDetails::make(409, 'illegal_transition', $e->getMessage())` — which puts
 * the message written for this exact situation in `title` and leaves `detail` unset.
 * `humanise()` consults `detail` and then falls into a `switch (status)` whose 409 arm
 * returns "That has already changed. Please review it and try again." So the API's own
 * explanation — "Only a cash payment taken at the clinic may be attested by staff. A
 * mobile-money or card collection is resolved by the aggregator that took it, or by
 * reconciliation — never by hand." — is thrown away exactly where it is most needed.
 *
 * Reading `title` first restores it. The order below still prefers `detail` where the API
 * supplies one, so nothing else changes shape; the fallback is `error.message`, which is
 * `humanise()`'s answer and is right for every other status.
 *
 * The fix belongs in `humanise()`, in packages/api-client, which is shared by four apps and
 * is not this change's to alter. Written down in the handover.
 */
function messageFor(error: ApiError): string {
  if (error.status !== 409) {
    return error.message
  }

  return error.problem.detail ?? error.problem.title ?? error.message
}

/**
 * Which of the five things went wrong.
 *
 * A 409 is the state machine refusing, and it arrives for two quite different reasons the
 * screen has to tell apart: the attempt was already resolved, or the method was never cash
 * in the first place. The API's own sentence distinguishes them and is shown verbatim
 * either way; this only decides which heading it sits under. The match is loose on purpose
 * — a wording change in the backend degrades this to `already_resolved`, which is the more
 * conservative of the two, rather than breaking the screen.
 */
function classify(error: ApiError): 'forbidden' | 'not_found' | 'already_resolved' | 'not_cash' | 'other' {
  if (error.status === 403) {
    return 'forbidden'
  }

  if (error.status === 404) {
    return 'not_found'
  }

  if (error.status === 409) {
    return messageFor(error).toLowerCase().includes('cash payment taken at the clinic')
      ? 'not_cash'
      : 'already_resolved'
  }

  return 'other'
}
