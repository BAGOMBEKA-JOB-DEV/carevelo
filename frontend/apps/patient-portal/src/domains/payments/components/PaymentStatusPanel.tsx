import { getReceipt, handoffFor } from '../api/paymentIntents'
import { statusOf } from '../api/types'
import { PaymentCheckoutReturn } from './PaymentCheckoutReturn'
import { PaymentFailed, PaymentReversed } from './PaymentFailed'
import { PaymentNotStarted, PaymentWaiting } from './PaymentWaiting'
import { PaymentReceiptCard } from './PaymentReceiptCard'
import { PaymentUnresolved } from './PaymentUnresolved'
import type { PaymentScreenProps } from './screen'

/**
 * One payment attempt, rendered as whatever it actually is.
 *
 * THE SWITCH IS EXHAUSTIVE OVER A NARROWED UNION, so a state added to the backend cannot
 * quietly land on a default arm that says something comforting. `statusOf()` maps anything
 * unrecognised to `unknown`, and `unknown` renders the "we cannot tell" screen — never the
 * receipt.
 *
 * THE RECEIPT IS FETCHED HERE rather than by the route, so a route composing this holds one
 * call and no branching. That is the whole reason this component exists: `app/` may compose
 * and render, and choosing which of six screens a payment state deserves is not composition.
 *
 * ON RE-FETCHING RATHER THAN TRUSTING A SIGNAL. Whatever prompted this render — a timer, a
 * patient pressing Check again, a realtime hint if the socket is ever wired — the intent
 * passed in was read from `GET /v1/payment-intents/{id}` by the server on THIS render. No
 * screen below renders a paid state from anything else.
 *
 * ------------------------------------------------------------------
 * TWO UNRESOLVED STATES HAVE A SECOND SCREEN EACH, AND THE HANDOFF IS WHAT CHOOSES.
 *
 * `initiated` and `pending` mean different things depending on how the clinic's aggregator
 * collects. On a push aggregator they are what they always were: nothing has started yet, or
 * a handset has been prompted. On a hosted-checkout aggregator they mean the patient was
 * sent to a page of the aggregator's own and is now HERE instead — which is to say they came
 * back without finishing, or the callback has returned them and the answer has not caught up.
 *
 * Those are different situations and they get different screens, because the push screens
 * say "check your phone" and "nothing has been asked of your phone", and both sentences are
 * false for a patient whose payment is a browser tab they closed. `handoffFor` decides from
 * the intent itself — never from the method — and the argument for that is in
 * api/paymentIntents.ts. It answers `hosted_checkout` only for these two states, so the four
 * arms below are unaffected by construction.
 */
export async function PaymentStatusPanel({
  tenant,
  intent,
  checkAgainHref,
  retryHref,
}: PaymentScreenProps) {
  const status = statusOf(intent)
  const handoff = handoffFor(intent)

  switch (status) {
    case 'succeeded': {
      // Only now, and only for this state: a receipt exists solely for a succeeded intent.
      const receipt = await getReceipt(intent.id)

      return <PaymentReceiptCard tenant={tenant} intent={intent} receipt={receipt} />
    }

    case 'pending':
      // The aggregator is collecting. On its own page, if it has one — so `collecting`,
      // which puts "Check again" in the primary position rather than the way back.
      return handoff.kind === 'hosted_checkout' ? (
        <PaymentCheckoutReturn
          tenant={tenant}
          intent={intent}
          checkAgainHref={checkAgainHref}
          retryHref={retryHref}
          checkoutUrl={handoff.url}
          collecting
        />
      ) : (
        <PaymentWaiting
          tenant={tenant}
          intent={intent}
          checkAgainHref={checkAgainHref}
          retryHref={retryHref}
        />
      )

    case 'initiated':
      /*
       * PaymentNotStarted reads `initiated` as "nothing has been collected", which is true
       * in the two push-model ways it describes — cash waiting at a desk, or an aggregator
       * we could not reach — and is NOT true where a hosted checkout is involved. There,
       * `initiated` is simply the status an intent is created with and keeps until an IPN
       * prompts the backend to go and ask; a patient who has paid in full sits in it for as
       * long as that takes. So this arm must not assert a negative, and
       * PaymentCheckoutReturn is written not to.
       */
      return handoff.kind === 'hosted_checkout' ? (
        <PaymentCheckoutReturn
          tenant={tenant}
          intent={intent}
          checkAgainHref={checkAgainHref}
          retryHref={retryHref}
          checkoutUrl={handoff.url}
        />
      ) : (
        <PaymentNotStarted
          tenant={tenant}
          intent={intent}
          checkAgainHref={checkAgainHref}
          retryHref={retryHref}
        />
      )

    case 'failed':
      return (
        <PaymentFailed
          tenant={tenant}
          intent={intent}
          checkAgainHref={checkAgainHref}
          retryHref={retryHref}
        />
      )

    case 'reversed':
      return (
        <PaymentReversed
          tenant={tenant}
          intent={intent}
          checkAgainHref={checkAgainHref}
          retryHref={retryHref}
        />
      )

    case 'timed_out':
      return (
        <PaymentUnresolved
          tenant={tenant}
          intent={intent}
          checkAgainHref={checkAgainHref}
          retryHref={retryHref}
        />
      )

    case 'unknown':
      return (
        <PaymentUnresolved
          tenant={tenant}
          intent={intent}
          checkAgainHref={checkAgainHref}
          retryHref={retryHref}
          recognised={false}
        />
      )
  }
}
