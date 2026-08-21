'use client'

import type { ReactElement } from 'react'
import { PortalErrorScreen } from '../../error'

/**
 * A payment status page that could not be built.
 *
 * THIS IS THE ONE ERROR SCREEN IN THE PORTAL THAT MUST BE READ AS EVIDENCE OF NOTHING.
 * Every other failed page is an inconvenience; this one sits between a patient and the
 * question "did my money leave, and did it arrive". A screen that failed before it read
 * anything knows neither, and the copy says exactly that — not "something went wrong",
 * which a worried person reads as "it failed", and not a reassurance, which would be a
 * claim this component has no basis for.
 *
 * SO IT TELLS THEM NOT TO PAY AGAIN. The realistic harm on this route is not a lost page;
 * it is a second mobile-money transfer sent because the first one appeared to break, and
 * then a refund that takes days and a clinic visit. Telephoning the clinic is the correct
 * next action and the copy names it, with the digest to read out.
 *
 * `reset()` is a re-render of a read-only status page. It cannot start, retry or repeat a
 * payment: nothing on this route charges anybody, and the mutation that does lives behind
 * a Server Action that re-rendering does not replay.
 */
export default function PaymentStatusError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return <PortalErrorScreen section="payment" error={error} reset={reset} />
}
