import { notFound, redirect } from 'next/navigation'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { getPaymentIntent, PaymentStatusPanel } from '@/domains/payments'
import { SiteShell } from '@/components/SiteShell'
import { PageBody } from '@/components/PageBody'

/**
 * One payment attempt, for as long as it is unresolved — and the receipt once it is not.
 *
 * ONE PAGE FOR EVERY STATE, AND THAT IS THE DOMAIN'S RULE RATHER THAN A ROUTING SHORTCUT.
 * `PaymentStatusPanel` chooses between the waiting screen, the not-started screen, the way
 * back to an unfinished payment page, the failure, the reversal, the honest "we cannot tell"
 * and the receipt. Which status deserves
 * which screen IS the business rule the payments domain owns — exactly one status means
 * paid, a timeout is not a failure, an unrecognised status is never success — and a route
 * picking its own would be that rule restated in the routing tree, free to drift from the
 * one the domain enforces. So there is no `/pay/{id}/receipt` rendering of its own here;
 * see the sibling directory for the redirect that keeps that URL alive.
 *
 * NOT STATIC, AND NOTHING HERE MAY MAKE IT SO. The read goes through the API client with
 * the session cookie, so the render is dynamic already; adding any caching would show a
 * patient a `pending` payment that succeeded four minutes ago, on the one screen they are
 * watching for a change. The panel re-renders itself on a widening schedule and the whole
 * of that re-render happens on the server, so a paid state can only ever come from a fresh
 * `GET /v1/payment-intents/{id}`.
 *
 * `null` IS 404 AND 403 ALIKE, collapsed by the domain on purpose so that this route
 * renders one not-found page for both and never leaks which clinic holds which record.
 *
 * THIS IS WHERE A HOSTED CHECKOUT SHOULD COME BACK TO, AND TODAY IT DOES NOT. WRITTEN DOWN
 * HERE BECAUSE THE GAP IS INVISIBLE FROM INSIDE THIS APP.
 *
 * A patient who pays at an aggregator hosting its own page is returned by that aggregator to
 * whatever callback URL the order carried. `PesapalGateway::callbackUrl()` sends a SINGLE
 * STATIC URL with no intent id in it — `PESAPAL_CALLBACK_URL`, defaulting to
 * `APP_URL + /payments/return` — and this portal has no `/payments/return` route. Pointed at
 * the portal as `backend/.env.example` instructs, that path falls into THIS dynamic segment
 * with `payment` = `return`, which is not an id, so the read returns null and a patient who
 * has just paid is shown "page not found".
 *
 * Resolving it needs something this side cannot supply on its own: either the backend puts
 * the intent id in the callback URL it submits per order, or the API grows a way to look an
 * intent up by the `OrderMerchantReference` (our `PAY-…` reference) that the aggregator hands
 * back. Until one of those exists, the reachable route to this page is the patient's own
 * navigation — their appointment, their orders, the link they already had.
 *
 * WHAT THIS PAGE DOES DO IS SURVIVE THE ARRIVAL. An aggregator appends identifiers of its own
 * — Pesapal sends `OrderTrackingId` and `OrderMerchantReference`. Nothing here reads them and
 * nothing here should: they are the aggregator's word for what happened, and the only account
 * of a payment this portal will render is the one it just read from
 * `GET /v1/payment-intents/{id}`. Unlisted search parameters are ignored, so once the id does
 * arrive here a callback carrying three of them renders the same page as a patient who typed
 * the URL — and a patient who comes back with no parameters at all lands somewhere truthful
 * rather than nowhere.
 *
 * ---------------------------------------------------------------------------------------
 * `?payable=` EXISTS BECAUSE THE CONTRACT DOES NOT CARRY THE PAYABLE, and this is a gap in
 * the API rather than a decoration.
 *
 * The domain is explicit that `retryHref` must point at the method chooser for the SAME
 * payable, carrying `after=<this intent's id>`: without `after` the chooser derives the
 * same idempotency key as the attempt being retried, the API replays the stored response,
 * and the patient is handed back the failure they were escaping. But
 * `PaymentIntentResource` states id, reference, status, amount, method,
 * `aggregator_reference`, `failure_message`, `initiated_at` and `resolved_at` — and neither
 * `payable_type` nor `payable_id`. There is nothing on this resource to build the chooser's
 * URL from.
 *
 * So the routes that START a payment write it into `statusPathTemplate`, and this one reads
 * it back. It is matched against a CLOSED SET of the two payable types the contract defines
 * and reconstructed into a path from literals here — never used as a redirect target, and
 * never trusted as anything but a hint. A crafted or absent value costs the retry link and
 * nothing else: `retryHref` is optional, and its absence means the screen offers no retry
 * rather than offering a broken one. Note the payable identifier is an appointment or an
 * order, never a patient id — the same line the consultation route holds.
 *
 * WHEN `payable_type` AND `payable_id` REACH `PaymentIntentResource`, delete the search
 * parameter, delete `retryPathFor`, and build the link from the intent itself.
 * ---------------------------------------------------------------------------------------
 */
export default async function PaymentStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ payment: string }>
  searchParams: Promise<{ payable?: string }>
}) {
  const [tenant, user, { payment }, query] = await Promise.all([
    resolveTenant(),
    currentUser(),
    params,
    searchParams,
  ])

  // The same two redirects as app/account/page.tsx. A payment record is one patient's
  // money; the check asks the API rather than reading the cookie.
  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  const intent = await getPaymentIntent(payment)

  if (!intent) {
    notFound()
  }

  const retryHref = retryPathFor(query.payable, intent.id)

  return (
    <SiteShell tenant={tenant} signedIn>
      <PageBody>
        {/* `checkAgainHref` is deliberately not passed: it defaults to the empty string,
            which re-requests THIS url, query string and all — precisely "ask the server
            again", with no JavaScript and no knowledge inside the domain of what this
            route calls itself. */}
        <PaymentStatusPanel tenant={tenant} intent={intent} retryHref={retryHref} />
      </PageBody>
    </SiteShell>
  )
}

/**
 * Where "try another way to pay" points, or nothing.
 *
 * A CLOSED SET AND LITERAL PATHS. The value arrives in the query string, so it is under the
 * control of whoever wrote the link; the two branches below are the only two payable types
 * `POST /v1/payment-intents` accepts, and each returns a path this routing tree wrote
 * rather than one the parameter supplied. Anything else — a third type, a missing value, a
 * crafted one — returns undefined, and an absent `retryHref` means the screen offers no
 * retry at all. That is the right direction to fail: a missing button is a telephone call,
 * a wrong one is a second collection against somebody's mobile money.
 *
 * `after` IS THE INTENT BEING RETRIED, which is what makes the next attempt derive a new
 * idempotency key. It is stable across re-renders of this page — it is this intent's id,
 * not a fresh random — so re-rendering cannot mint a new key and reintroduce, one level up,
 * the double-charge the derived key exists to prevent.
 */
function retryPathFor(payable: string | undefined, intentId: string): string | undefined {
  if (payable === undefined) {
    return undefined
  }

  const separator = payable.indexOf('.')
  const type = separator === -1 ? '' : payable.slice(0, separator)
  const id = separator === -1 ? '' : payable.slice(separator + 1)

  if (id === '') {
    return undefined
  }

  const after = `after=${encodeURIComponent(intentId)}`

  if (type === 'appointment') {
    return `/pay/appointment?appointment=${encodeURIComponent(id)}&${after}`
  }

  if (type === 'dispense_order') {
    return `/pay/order/${encodeURIComponent(id)}?${after}`
  }

  return undefined
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
