import { ApiError } from '@carevelo/api-client'
import { readClient, writeClient } from './client'
import { idempotencyKeyFor, type AttemptInput } from './idempotency'
import { isCash, statusOf, type PaymentIntent, type Receipt } from './types'

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

/* =========================================================================================
 * WHICH HANDOFF AN ATTEMPT IMPLIES — and the ONE place this app adapts to a field the
 * generated contract does not carry yet.
 *
 * ------------------------------------------------------------------
 * THERE ARE TWO GENUINELY DIFFERENT WAYS A COLLECTION FINISHES, AND THEY ARE NOT THE SAME
 * SCREEN WEARING DIFFERENT WORDS.
 *
 * THE PUSH. We ask the aggregator to collect; the aggregator prompts the patient's handset;
 * the patient enters a PIN; the answer reaches our API by webhook or by the reconciliation
 * poll. The patient stays on our screens throughout, and PaymentWaiting.tsx is written for
 * exactly that: "check your handset", "do not pay again", no progress bar.
 *
 * THE HOSTED CHECKOUT. We submit the order server-side and the aggregator answers with a
 * page of its own. The patient LEAVES this origin, pays on somebody else's page, and is
 * returned by a callback. Nothing will buzz on a handset merely because we created the
 * intent, so telling that patient to check their phone is a lie they will act on — they
 * will sit and watch a phone instead of finishing the payment that is one tap away.
 *
 * ------------------------------------------------------------------
 * WHY THE METHOD ALONE CANNOT DECIDE THIS, WHICH IS THE WHOLE REASON THIS FUNCTION EXISTS.
 *
 * The obvious implementation is a list — card redirects, mobile money pushes — and it is
 * wrong here. Which model applies is a property of THE CLINIC'S AGGREGATOR, not of the way
 * the patient chose to pay: one merchant account per clinic (ADR-0003), and a clinic whose
 * account is with a hosted-checkout aggregator collects EVERYTHING through that aggregator's
 * page, mobile money included. The portal cannot read which aggregator a clinic uses —
 * `AggregatorAccountResource` is administrator-only and nothing about a clinic's payment
 * configuration is exposed to a patient — so a method-shaped rule here would send half the
 * clinics to the wrong screen and there would be no way to tell from this side.
 *
 * So the ANSWER decides, not the question: the created intent either carries somewhere to
 * send the patient or it does not. That also means a clinic moving between aggregators
 * changes nothing in this app.
 *
 * The one method-shaped rule that remains is a refusal rather than a routing choice. Cash
 * at the clinic involves no aggregator at all — a member of staff attests it at the desk —
 * so a cash intent carrying a payment page is a contradiction in the contract, and the
 * honest response to a contradiction on a payments screen is to ignore the surprising half
 * rather than to send somebody to a page for money they are carrying in their hand.
 *
 * AND A RESOLVED ATTEMPT IS NEVER A HANDOFF. `POST /v1/payment-intents` replays the stored
 * response for a repeated Idempotency-Key, so a patient who re-submits the same form after
 * paying gets back their SUCCEEDED intent — with, on a hosted-checkout aggregator, the page
 * they paid on still recorded against it. Redirecting them there would invite a second
 * payment for a bill that is already settled, which is the one outcome this domain cannot
 * undo: the money is at the clinic's own aggregator and Carevelo holds nothing to give back.
 * `timed_out` is excluded for the same reason from the other end — the order has aged out at
 * the aggregator, PaymentUnresolved.tsx is the screen for it, and its whole argument is that
 * the patient should not start paying again yet.
 * ========================================================================================= */

export type PaymentHandoff =
  | {
      /**
       * The patient finishes on the aggregator's own page, at this URL. Absolute, on
       * somebody else's origin, and already checked by `checkoutUrlOf` below.
       */
      kind: 'hosted_checkout'
      url: string
    }
  | {
      /**
       * The answer arrives at OUR screens: a push to a handset, or a person at a desk
       * attesting cash. Everything that is not a redirect is this, including every case
       * where the contract said nothing useful — a screen that waits is recoverable, and a
       * redirect built out of an unrecognised value is not.
       */
      kind: 'awaited'
    }

const AWAITED: PaymentHandoff = { kind: 'awaited' }

/**
 * What this attempt asks of the patient next.
 *
 * The full argument is directly above. The order of the tests is the order of the risks:
 * resolved attempts first, then cash, then the URL itself.
 */
export function handoffFor(intent: PaymentIntent): PaymentHandoff {
  const status = statusOf(intent)

  if (status !== 'initiated' && status !== 'pending') {
    return AWAITED
  }

  if (isCash(intent.method)) {
    return AWAITED
  }

  const url = checkoutUrlOf(intent)

  return url === null ? AWAITED : { kind: 'hosted_checkout', url }
}

/**
 * ---------------------------------------------------------------------------------------
 * THE SEAM. The whole of this app's knowledge that `redirect_url` exists lives in this
 * function, and it is written against a contract that HAS NOT LANDED YET.
 *
 * `packages/api-client/src/generated/schema.d.ts` describes `PaymentIntentResource` as id,
 * reference, status, amount, method, `aggregator_reference`, `failure_message`,
 * `initiated_at` and `resolved_at`. There is no redirect field on it today, so there is no
 * generated type to read one off, and `frontend-nextjs.md` forbids hand-writing a response
 * shape beside the generated one. The compromise is this: ONE function that takes the
 * resource as `unknown` and narrows, the way `moneyFrom()` in ./types.ts already narrows an
 * amount the generator could not see through. Nothing else in this app — no component, no
 * route, no test fixture rendered on a screen — names the field.
 *
 * WHAT MUST BE CONFIRMED THE DAY THE BACKEND LANDS, ITEM BY ITEM:
 *
 *  1. THE FIELD IS CALLED `redirect_url`, and it is on `PaymentIntentResource`. The
 *     migration adds `payment_intents.redirect_url` and the gateway's value object calls it
 *     `redirectUrl` (backend/app/Services/Payments/CollectionHandoff.php), so the column and
 *     the concept are settled; what is not settled is what the RESOURCE calls it. If it is
 *     serialised as `checkout_url`, or nested under a `handoff` object, this function is the
 *     only edit.
 *  2. IT IS ON THE READ AS WELL AS THE CREATE. The create response is what redirects the
 *     patient; the READ is what lets `/payments/{id}` recognise a checkout the patient
 *     abandoned and offer them the same page back rather than a second order. If the field
 *     appears only on the create response, PaymentCheckoutReturn.tsx loses its resume link —
 *     it degrades to "check again", it does not break — and that is worth raising with the
 *     backend rather than working around here.
 *  3. IT IS NULL, NOT ABSENT, FOR A NON-REDIRECT AGGREGATOR, or absent, or an empty string.
 *     All three are handled below and all three mean the same thing, so nothing turns on
 *     which one is chosen.
 *  4. THEN DELETE THE CAST. Once the field is in the generated schema, `intent.redirect_url`
 *     type-checks, this narrowing becomes noise, and the `unknown` parameter should go with
 *     it. Everything else in this file and every caller stays exactly as it is.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THE URL IS CHECKED HERE EVEN THOUGH IT COMES FROM OUR OWN API.
 *
 * The value is not patient-supplied — it arrives on a server-to-server response, not in a
 * form field or a query string — so this is not the open-redirect control that
 * PaymentMethodChooser's `samePath()` is. It is the second copy of one: the backend already
 * refuses a non-https URL and one whose host is not the aggregator's
 * (`PesapalClient::isPesapalUrl`), and a control that costs three lines is worth having on
 * both sides of a wire. What it actually rules out is a payment screen navigating to
 * `javascript:`, to `data:`, or to a relative string that would send the patient somewhere
 * inside this portal while a comment claims they are at their bank.
 *
 * PLAINTEXT IS REFUSED EXCEPT ON LOOPBACK. A payment page reached over http is one a
 * network can rewrite, and this is the screen where that matters most. The loopback
 * exception exists so the local FakeGateway drives the REAL redirect path in development
 * rather than a special case that is never exercised until production.
 */
function checkoutUrlOf(intent: unknown): string | null {
  if (typeof intent !== 'object' || intent === null) {
    return null
  }

  const { redirect_url: candidate } = intent as { redirect_url?: unknown }

  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return null
  }

  let url: URL

  try {
    // `new URL(x)` with no base throws on a relative string, which is precisely the test
    // wanted: a checkout page is somewhere else by definition.
    url = new URL(candidate)
  } catch {
    return null
  }

  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    return null
  }

  // The parsed form rather than the string we were handed: it is normalised, it cannot
  // carry the leading whitespace a URL parser silently tolerates, and it is what the
  // browser would resolve anyway.
  return url.href
}
