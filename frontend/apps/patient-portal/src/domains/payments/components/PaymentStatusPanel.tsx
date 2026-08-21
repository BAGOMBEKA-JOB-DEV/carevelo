import { getReceipt } from '../api/paymentIntents'
import { statusOf } from '../api/types'
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
 */
export async function PaymentStatusPanel({
  tenant,
  intent,
  checkAgainHref,
  retryHref,
}: PaymentScreenProps) {
  const status = statusOf(intent)

  switch (status) {
    case 'succeeded': {
      // Only now, and only for this state: a receipt exists solely for a succeeded intent.
      const receipt = await getReceipt(intent.id)

      return <PaymentReceiptCard tenant={tenant} intent={intent} receipt={receipt} />
    }

    case 'pending':
      return (
        <PaymentWaiting
          tenant={tenant}
          intent={intent}
          checkAgainHref={checkAgainHref}
          retryHref={retryHref}
        />
      )

    case 'initiated':
      return (
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
