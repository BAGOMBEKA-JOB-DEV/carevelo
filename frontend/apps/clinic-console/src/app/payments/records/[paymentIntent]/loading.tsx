import type { ReactElement } from 'react'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * One payment record, held in place while it is read.
 *
 * IT EXISTS SEPARATELY FROM `payments/loading.tsx` BECAUSE THAT ONE IS THE DESK — a search
 * field and three explanatory cards — and this is a record. A clerk who has just typed a
 * reference into the desk and pressed Open would otherwise watch the desk's own placeholder
 * come back at them, which reads as a form that did not submit.
 *
 * IT IS ALSO THE SLOWEST ROUTE IN THE SECTION, AND SEQUENTIALLY SO. The page reads the
 * payment intent, and only once it knows the status does it decide whether to read the
 * receipt — two round trips one after the other, not two in parallel. The person waiting is
 * usually standing at a desk with a patient in front of them asking whether their payment
 * arrived.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here rather than skeletoned.
 *
 * ------------------------------------------------------------------------------------
 * NOTHING ON THIS SCREEN IS GUESSED, AND ON THIS ROUTE THAT IS NOT CAUTION — IT IS THE
 * WHOLE JOB.
 *
 * The <h1> is the payment's reference; the line under it is the method and the AMOUNT; the
 * badge beside it is whether the payment succeeded. Every one of those is a fact a clerk is
 * about to repeat out loud to a patient, and `loading.tsx` is given no props, so this file
 * knows none of them. A grey bar the size of a status badge is a status to anybody
 * glancing, and "succeeded" glanced at wrongly is a patient sent away having paid twice or
 * not at all.
 *
 * So the head is reserved and empty, no figure is sketched as a figure, and no badge shape
 * appears anywhere below. `payments/error.tsx` makes the same argument for the failure
 * case: a payments screen that has read nothing must say it knows nothing.
 * ------------------------------------------------------------------------------------
 */
export default function PaymentRecordLoading(): ReactElement {
  return (
    <ConsoleShell title="Payments" active="payments">
      <Stack gap="6">
        {/* The nav across the desk, reconciliation, messages and the audit trail. Rendered
            as a reserved row rather than for real, matching `payments/loading.tsx`: the tab
            that is current on this route is the desk's, and drawing the tabs here would
            mean this file holding a copy of a list the payments domain owns. */}
        <Skeleton lines={1} />

        {/* The page head: reference, method and amount, status badge. */}
        <Stack gap="3">
          <Skeleton lines={1} className="title-lg" />
          <Skeleton lines={1} />
        </Stack>

        {/* "What we recorded" — the definition list of reference, method, amount, times and
            whatever the aggregator said. The tallest block and the one the page is for. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="lg" />
          </Stack>
        </Card>

        {/* The second panel: the receipt when the payment succeeded, the cash-attestation
            control when it was taken at the counter, and a standing notice when it is one
            of the states that resolves on its own. Which of the three arrives is exactly
            what this fallback cannot know, so it reserves the room and names none of them. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="md" />
          </Stack>
        </Card>
      </Stack>
    </ConsoleShell>
  )
}
