import { ApiError } from '@carevelo/api-client'
import { readClient, writeClient } from './client'
import { idempotencyKeyFor, type AttemptInput } from './idempotency'
import type { PaymentIntent, Receipt } from './types'

/**
 * The three calls this domain makes, and nothing else.
 *
 * `POST /v1/payment-intents` records an attempt. `GET /v1/payment-intents/{id}` is polled
 * while it is unresolved. `GET /v1/payment-intents/{id}/receipt` is the document, and its
 * payee is the clinic.
 *
 * THERE IS NO REFUND CALL HERE BECAUSE THERE IS NO REFUND ENDPOINT, and that is a product
 * decision rather than a missing feature: the money went to the clinic's own account at the
 * clinic's own aggregator, so Carevelo has nothing to give back and could not give it back
 * without becoming the kind of business the whole architecture exists to avoid being. The
 * backend states it in the same terms — `PaymentIntentPolicy::refund()` returns `false` with
 * the comment "there is no refund permission, because there is no refund capability".
 * RefundGuidance.tsx is what the patient sees instead.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */

export type StartPaymentInput = AttemptInput

export type StartPaymentResult =
  | { ok: true; intent: PaymentIntent }
  | {
      ok: false
      /**
       * Our own classification, so a screen can say something specific without
       * re-inspecting the problem document.
       */
      reason: 'forbidden' | 'key_reused' | 'unauthenticated' | 'other'
      /** The API's own sentence, already humanised. Never a raw payload. */
      message: string
    }

/**
 * Record a payment attempt.
 *
 * THE IDEMPOTENCY KEY IS DERIVED FROM THE BODY, so this function is safe to call twice with
 * the same input: the second call returns the first call's stored intent and the patient's
 * handset is prompted once. See ./idempotency.ts for the whole argument — it is the most
 * important thing in this domain.
 *
 * 201 for a new attempt, 200 for a replay. Both carry the same resource and this makes no
 * distinction between them, because there is none worth making to the patient: they pressed
 * pay, and this is their payment.
 */
export async function startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
  const key = await idempotencyKeyFor(input)

  try {
    const client = await writeClient()

    const response = await client.post<{ data: PaymentIntent }>(
      '/v1/payment-intents',
      {
        payable_type: input.payable.type,
        payable_id: input.payable.id,
        amount_minor: input.amountMinor,
        method: input.method,
      },
      { idempotencyKey: key },
    )

    return { ok: true, intent: response.data }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error
    }

    return { ok: false, reason: classify(error), message: error.message }
  }
}

function classify(error: ApiError): 'forbidden' | 'key_reused' | 'unauthenticated' | 'other' {
  if (error.status === 401) {
    return 'unauthenticated'
  }

  if (error.status === 403) {
    return 'forbidden'
  }

  /*
   * `idempotency_key_reused`: the same key arrived with a different body.
   *
   * UNREACHABLE FROM THIS UI, and the screen says so in as many words rather than offering
   * a retry. The key is derived from exactly the four fields the server fingerprints, so
   * identical inputs cannot produce a differing body — if this ever fires, either something
   * else is minting keys into the same space or the derivation and the fingerprint have
   * drifted apart, and quietly retrying under a fresh key would turn a broken invariant
   * into a second collection. `code` is not on the shared Problem type; the `type` URI is.
   */
  if (error.status === 409 && error.problem.type?.endsWith('idempotency_key_reused') === true) {
    return 'key_reused'
  }

  return 'other'
}

/**
 * One payment attempt, or null.
 *
 * NULL COVERS 404 AND 403 ALIKE, and collapsing them is the point. The API answers a
 * cross-tenant reference with 404 so that nobody can discover which clinic holds which
 * record; a portal that turned a 403 into a distinguishable screen would hand that
 * distinction straight back. The caller renders "not found" for both.
 *
 * The route decides what to do with null — normally `notFound()`. Doing it here would put
 * a routing decision inside the domain.
 */
export async function getPaymentIntent(id: string): Promise<PaymentIntent | null> {
  try {
    const client = await readClient()
    const response = await client.get<{ data: PaymentIntent }>(`/v1/payment-intents/${encodeURIComponent(id)}`)

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
 * NULL RATHER THAN A THROW ON ANY FAILURE. The intent is the record; the receipt is a
 * rendering of it. A patient who has paid and whose receipt call fails should still see
 * that they have paid, from the intent, with a line saying the receipt could not be loaded
 * — losing the whole screen because a second call failed would be a worse answer to
 * "did my money arrive" than a partial one.
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
