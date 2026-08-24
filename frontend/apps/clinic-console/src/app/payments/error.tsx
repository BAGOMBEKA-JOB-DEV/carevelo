'use client'

import type { ReactElement } from 'react'
import { Button } from '@carevelo/ui'
import { ConsoleErrorScreen } from '../error'

/**
 * A payments screen that could not be built.
 *
 * WHY THIS SECTION GETS ITS OWN BOUNDARY. Everywhere else in the console a failed page is
 * an interruption; here it is a page that a clerk will otherwise work around by hand. The
 * money desk, the reconciliation day and a payment record are all screens somebody is
 * looking at because a patient is standing in front of them asking whether their payment
 * arrived. A generic "something went wrong" invites the clerk to answer from memory, or to
 * open a second record and act on the wrong one.
 *
 * SO THE COPY STATES THE ONE FACT THAT MATTERS: the page failed BEFORE it read anything, so
 * nothing on it is evidence about any payment, in either direction. It does not reassure —
 * this component has no basis for reassurance — and it does not alarm. It says the screen
 * knows nothing and names what to do instead.
 *
 * `reset()` is safe on every route under /payments: these are reads. Recording, refunding
 * and reconciling are Server Actions, and re-rendering the page an action was invoked from
 * does not replay the action.
 *
 * Nothing about the payment, the patient or the amount appears here — there is nothing in
 * this component that could render one, which is the point of keeping `error.message` off
 * the screen in the first place. See the parent boundary for the digest rule.
 */
export default function PaymentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return (
    <ConsoleErrorScreen
      title="The payments screen did not load"
      error={error}
      reset={reset}
      actions={
        <>
          <Button variant="quiet" size="lg" href="/payments">
            Back to the money desk
          </Button>
          <Button variant="ghost" size="lg" href="/schedule">
            Go to the schedule
          </Button>
        </>
      }
    >
      This page failed before it could read anything, so nothing on it tells you the state of
      any payment — not that one succeeded, and not that one failed. Do not record, refund or
      repeat anything on the strength of this screen. Try once more, and if it still will not
      open, check the payment record itself before telling a patient anything.
    </ConsoleErrorScreen>
  )
}
