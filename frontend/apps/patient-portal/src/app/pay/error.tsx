'use client'

import type { ReactElement } from 'react'
import { PortalErrorScreen } from '../error'

/**
 * The screen where a patient chooses how to pay could not be built.
 *
 * WHY THE PAYING ROUTES GET THEIR OWN BOUNDARY AND NOT THE GENERIC ONE. `/pay/appointment`
 * and `/pay/order/[order]` both render `PaymentMethodChooser`, and both sit directly in
 * front of a mobile-money transfer. The generic screen's copy — "nothing you have done has
 * been lost and nothing has been changed" — is true of a failed catalogue page and is not
 * a sentence to put in front of somebody who has just pressed a button with an amount on
 * it. What they need to be told is narrower and sharper: this page does not know, so do not
 * send money again on the strength of it.
 *
 * IT REUSES section="payment", WHICH IS THE SAME WORDS AS THE STATUS PAGE, AND THAT IS
 * CORRECT RATHER THAN LAZY. The two screens sit on opposite sides of one moment — the
 * chooser before a transfer, the status page after it — and the only honest thing either
 * can say when it has failed before reading anything is the same thing: this screen is not
 * evidence, in either direction, and a second payment is the expensive way to find out. A
 * refund in this market is days and a visit to the clinic.
 *
 * ONE FILE FOR BOTH ROUTES. Next walks up to the nearest boundary, so this catches
 * `/pay/appointment` and `/pay/order/[order]` alike. There is no per-route difference to
 * express: neither screen may name what is being paid for, because a sentence like "your
 * medicines could not be priced" already discloses that there are medicines.
 *
 * `reset()` re-renders the segment, which is a read of a service price or an order total.
 * It cannot start, retry or repeat a payment: `submitPayment` is a Server Action, and
 * re-rendering the page an action was invoked from does not replay the action.
 */
export default function PayError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return <PortalErrorScreen section="payment" error={error} reset={reset} />
}
