import { Notice } from '@carevelo/ui'

/**
 * What to do when a patient has to be given their money back.
 *
 * THERE IS NO REFUND BUTTON HERE, AND THERE IS NO ENDPOINT BEHIND ONE. That is a product
 * decision stated in three places and worth stating in a fourth: the money went to the
 * clinic's own account at the clinic's own aggregator, so Carevelo holds nothing to refund
 * from and could not refund without becoming a custodian of patient money — which is the
 * regulated business this entire architecture exists to avoid being. The backend says the
 * same thing in the same terms: `PaymentIntentPolicy::refund()` returns `false` with the
 * comment "there is no refund permission, because there is no refund capability".
 *
 * A DISABLED "REFUND" BUTTON WOULD BE WORSE THAN NOTHING. It would read as a feature the
 * clinic has not been given rather than one that does not and will not exist, and it would
 * generate exactly the support call this text is written to prevent. So the screen says
 * plainly where the refund is actually performed, and what Carevelo can record about it.
 */
export function RefundGuidance() {
  return (
    <Notice tone="neutral" title="Refunding a patient">
      <p>
        Refunds are made by your clinic, through the aggregator that took the payment.
        Carevelo has no refund control because it never received the money — there is no
        button here that has been switched off, there is no path for one.
      </p>
      <p>
        Once you have made the refund, note it against the patient&rsquo;s record so the
        reason survives. The payment record below keeps the aggregator reference you will
        need to find the original transaction.
      </p>
    </Notice>
  )
}
