import { Notice } from '@carevelo/ui'

/**
 * "We reconcile records, not money."
 *
 * WHY THIS IS ON THE SCREEN AND NOT ONLY IN THE CONTRACT. The single most expensive
 * misunderstanding this product can produce is a clinic believing Carevelo holds its money.
 * From that belief follow the two support calls nobody can answer: "release my funds" and
 * "refund this patient". Neither is possible — the patient pays the clinic's own account at
 * the clinic's own aggregator and the platform is not in that path at any point — and the
 * place to prevent the belief is the screen where an administrator is looking at payment
 * records, not a page of terms nobody opens twice.
 *
 * It is also the honest caveat on every number in this section. Each figure here is a count
 * of RECORDS the platform wrote, not an observation of money that moved, and a clinic
 * reconciling its books needs to know which of the two it is reading.
 *
 * `tone="info"` rather than a warning: nothing is wrong, and a red box beside a working
 * screen teaches people to ignore red boxes.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 */
export function NonCustodialNotice() {
  return (
    <Notice tone="info" title="We reconcile records, not money">
      <p>
        Patients pay your clinic&rsquo;s own mobile-money account through your own
        aggregator. Carevelo never holds your money and cannot see what reached you — every
        figure on these screens is a count of the records we wrote, and each one carries the
        aggregator&rsquo;s reference so you can confirm it in your own dashboard.
      </p>
    </Notice>
  )
}
