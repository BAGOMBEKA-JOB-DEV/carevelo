/**
 * The payments domain's PUBLIC SURFACE.
 *
 * Everything this domain offers the rest of the app is exported here and nothing else is
 * importable: reaching into ./components or ./api from another domain is a build failure,
 * not a code-review note. Cross-domain composition belongs in the route layer.
 *
 * ------------------------------------------------------------------
 * WHAT A ROUTE HAS TO DO WITH THIS, IN FULL.
 *
 * Four screens and one route handler, all under /payments, each of them thin.
 *
 * 1. THE DESK, at `app/payments/page.tsx`:
 *
 *      <ConsoleShell title="Payments" active="payments">
 *        <SectionNav active="desk" />
 *        <MoneyDeskScreen selfPath="/payments" problem={params.problem} />
 *      </ConsoleShell>
 *
 * 2. ONE PAYMENT RECORD, at `app/payments/records/[paymentIntent]/page.tsx`:
 *
 *      const intent = await getPaymentIntent(id)
 *      if (!intent) notFound()
 *      const receipt = isSucceeded(intent.status) ? await getReceipt(id) : null
 *
 *    `getPaymentIntent` returns null for 404 AND 403 alike, so the route renders one
 *    not-found page for both and never leaks which clinic holds which record. The receipt
 *    is only fetched for a succeeded attempt, because only a succeeded attempt has one —
 *    asking otherwise is a guaranteed 409 and a wasted round trip on a screen somebody is
 *    standing at a counter waiting for.
 *
 * 3. CONFIRMED PAYMENTS, at `app/payments/confirmed/page.tsx`:
 *
 *      const result = await getAggregatorConfirmedPayments(params.from, params.to, params.cursor)
 *
 *    All three parameters go through UNINTERPRETED and none is defaulted. The API resolves
 *    the window in the CLINIC's own days and answers the clinic's current month when
 *    neither date is given; a default computed in this Node process is the server's idea of
 *    the month, which in a UTC container is the wrong month for a Kampala owner for three
 *    hours at each end of it. `cursor` is opaque and is handed back exactly as it arrived —
 *    there is no `page` on this endpoint and `?page=2` is a 422, not a discarded parameter.
 *
 *    `result.ok === false` is NOT an error page, for the same reason as reconciliation:
 *    403 means the reader is not a clinic administrator, which is the boundary working.
 *
 * 4. RECONCILIATION, at `app/payments/reconciliation/page.tsx`:
 *
 *      const result = await getReconciliation(params.date)
 *
 *    The route passes `date` through UNINTERPRETED. Do not default it: the API resolves the
 *    day in the CLINIC's timezone from the tenant it already has bound, and a default
 *    computed in the Node process is the server's idea of today — the wrong day for a
 *    Kampala administrator reconciling the evening's takings.
 *
 *    `result.ok === false` is NOT an error page. A 403 here means the reader is not a
 *    clinic administrator, which is the boundary working; the screen renders it as such.
 *
 * 5. THE CSV, at `app/payments/reconciliation/export/route.ts`:
 *
 *      const result = await exportReconciliation(from, to)
 *
 *    A Route Handler rather than a page, because the browser has to receive it as a
 *    download. Pass the API's own `Content-Disposition` straight through so the filename is
 *    the backend's and not a guess, and redirect back to the screen with a sentence when the
 *    range is refused.
 *
 * NONE OF THESE SCREENS MAY BE STATIC. They read cookies through the API client, so they are
 * dynamic already; do not add caching to any of them. A cached payment record is a front
 * desk being told about yesterday.
 *
 * ------------------------------------------------------------------
 * WHAT THIS DOMAIN WILL NEVER OFFER.
 *
 * A REFUND. There is no refund endpoint, no refund permission and no refund capability —
 * the money went to the clinic's own account at the clinic's own aggregator and Carevelo
 * holds nothing to give back. `RefundGuidance` says where the refund is actually performed.
 * A disabled button would read as a feature somebody has been denied rather than one that
 * does not exist, so there is not one.
 *
 * A REVENUE FIGURE. THIS PARAGRAPH USED TO SAY THE OPPOSITE OF WHAT IT SAYS NOW, and the
 * half that changed is worth separating from the half that did not.
 *
 * It said there was no endpoint that could answer "what did we take this month?" honestly,
 * because the only numbers available were counts of recorded ATTEMPTS rather than
 * observations of money, and a clinic makes decisions on that number so it must not be
 * invented. `GET /v1/revenue` answers a narrower question that IS honest: what the clinic's
 * OWN aggregator reported as completed, with the amount checked against the amount we asked
 * it to collect. `AggregatorConfirmedScreen` shows that and nothing more.
 *
 * WHAT STILL DOES NOT EXIST HERE, and will not: a figure called revenue, received, earned,
 * collected or takings; a total that claims money reached the clinic's account; a chart of
 * a trend the endpoint returns no series for. Money never passes through Carevelo, no
 * account exists here for it to pass through, and nobody here can see the clinic's bank
 * account — so "the aggregator confirmed it" and "the money arrived" stay different
 * statements, and only the first is this domain's to make.
 *
 * A LIST OF PAYMENTS. `GET /v1/payment-intents` does not exist. An attempt is reached by
 * its id, or through reconciliation, which is administrator-only.
 */

/* ---- Data. For a route that must 404, or hand a result to a screen. ---- */
export { getPaymentIntent, getReceipt } from './api/paymentIntents'
export { exportReconciliation, getReconciliation } from './api/reconciliation'
export { getAggregatorConfirmedPayments } from './api/revenue'
export { isSucceeded, type PaymentIntent, type Receipt } from './api/types'

/* ---- Screens. ---- */
export { MoneyDeskScreen } from './components/MoneyDeskScreen'
export {
  AggregatorConfirmedScreen,
  type AggregatorConfirmedScreenProps,
} from './components/AggregatorConfirmedScreen'
export { PaymentRecordScreen, type PaymentRecordScreenProps } from './components/PaymentRecordScreen'
export { ReconciliationScreen, type ReconciliationScreenProps } from './components/ReconciliationScreen'

/* ---- The section's own tab bar, shared by all four routes under /payments. ---- */
export { SectionNav, type MoneyTabId } from './components/SectionNav'

/*
 * DELIBERATELY NOT EXPORTED: attestCash, and the transport.
 *
 * `attestCash` is reachable only through the attestation form's own server action, which is
 * what pairs the call with the affirmation the person had to tick. An exported attest
 * function is an invitation to call it from a route with no affirmation in front of it —
 * and an audit event naming a colleague who never saw the cash is the one thing this
 * control exists to make hard.
 *
 * `readClient`, `writeClient` and `getText` are plumbing. A domain that needs the API needs
 * its own transport, not this one; see the note at the top of api/http.ts about where this
 * belongs once a third caller appears.
 */
