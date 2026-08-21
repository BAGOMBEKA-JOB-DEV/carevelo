'use client'

import type { ReactElement } from 'react'
import { PortalErrorScreen } from '../error'

/**
 * Booking failed, and the recovery genuinely differs — which is the only reason this file
 * exists rather than letting app/error.tsx catch it.
 *
 * THE DANGER ON THIS ROUTE IS A SECOND BOOKING. `confirmBooking` holds a slot, and a
 * patient who sees a broken page after pressing it has no way of knowing whether the hold
 * was taken. The instinct is to start again — and a patient who books twice has two of the
 * clinic's slots, one of which nobody will attend and the clinic cannot resell. So the
 * words here do not say "try again"; they say look at your appointments FIRST, because
 * that list is the only place on this surface where the answer is actually true.
 *
 * `reset()` is still offered and is still safe: it re-renders the segment, which is a read.
 * It does not resubmit anything — a Server Action is not replayed by re-rendering the page
 * it was invoked from.
 *
 * Nothing about the service, the clinician or the time appears here. A sentence naming what
 * was being booked would be clinical content on a screen that has no reason to hold any.
 */
export default function BookError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return <PortalErrorScreen section="booking" error={error} reset={reset} />
}
