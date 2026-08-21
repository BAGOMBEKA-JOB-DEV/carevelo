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
 * Two screens, and the second one is where a payment lives for as long as it is unresolved.
 *
 * 1. THE CHOOSER, at a path of the route's choosing — say `app/pay/[type]/[id]/page.tsx`:
 *
 *      const tenant = await resolveTenant()
 *      const { after, error } = await searchParams
 *
 *      <PaymentMethodChooser
 *        tenant={tenant}
 *        payable={{ type: 'dispense_order', id }}
 *        amount={order.total}              // the API's own priced value, never a literal
 *        statusPathTemplate="/payments/{id}"
 *        selfPath={`/pay/dispense_order/${id}`}
 *        after={typeof after === 'string' ? after : undefined}
 *        error={typeof error === 'string' ? error : undefined}
 *      />
 *
 *    `after` and `error` are ordinary search parameters and the route must pass both
 *    through. `after` is what makes a retry a NEW attempt rather than a replay of the last
 *    one; `error` is how a failed submission comes back with something to read.
 *
 * 2. THE STATUS SCREEN, at whatever `statusPathTemplate` named — `app/payments/[id]/page.tsx`:
 *
 *      const intent = await getPaymentIntent(id)
 *      if (!intent) notFound()
 *
 *      <PaymentStatusPanel
 *        tenant={tenant}
 *        intent={intent}
 *        retryHref={`/pay/dispense_order/${payableId}?after=${intent.id}`}
 *      />
 *
 *    `getPaymentIntent` returns null for 404 AND 403 alike, so the route renders one
 *    not-found page for both and never leaks which clinic holds which record.
 *
 *    `retryHref` MUST carry `after=<this intent's id>`. Without it the chooser derives the
 *    same idempotency key as the attempt being retried, the API replays the stored response,
 *    and the patient is returned to the failure they were trying to escape. With it, the key
 *    is new — which is what a retry is.
 *
 *    `checkAgainHref` is optional and defaults to re-requesting the current URL, which is
 *    almost always what is wanted.
 *
 * THE STATUS PAGE MUST NOT BE STATIC. It reads cookies through the API client, so it is
 * dynamic already; do not add caching to it. The patient is watching it for a state change.
 *
 * NOTHING HERE NEEDS A ROUTE HANDLER, A CLIENT FETCH OR AN API PROXY. The one client
 * component in the domain re-renders the server page on a timer and never talks to the API.
 */

/* ---- Data. For a route that must 404, set metadata, or link. ---- */
export { getPaymentIntent, getReceipt } from './api/paymentIntents'
export {
  isAwaitingAnswer,
  isPaid,
  moneyFrom,
  statusOf,
  PAYMENT_METHODS,
  type MoneyAmount,
  type Payable,
  type PayableType,
  type PaymentIntent,
  type PaymentMethodValue,
  type PaymentStatusValue,
  type Receipt,
} from './api/types'

/* ---- Screens. ---- */
export {
  PaymentMethodChooser,
  type PaymentMethodChooserProps,
} from './components/PaymentMethodChooser'
export { PaymentStatusPanel } from './components/PaymentStatusPanel'
export { PaymentStatusBadge } from './components/PaymentStatusBadge'
export { RefundGuidance } from './components/RefundGuidance'

/*
 * DELIBERATELY NOT EXPORTED: startPayment, and the six individual state screens.
 *
 * `startPayment` is reachable only through the chooser's own server action, which is what
 * derives the idempotency key from the body. An exported create function is an invitation
 * to call it with a key minted somewhere else — and a payment created with a fresh random
 * key on every submission is a patient charged twice on a slow connection.
 *
 * The individual screens are not exported because choosing between them IS the business
 * rule this domain owns: exactly one status means paid, a timeout is not a failure, and an
 * unrecognised status is never rendered as success. A route picking its own screen for a
 * status would be that rule, restated in the routing tree, free to drift.
 */
