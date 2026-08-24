'use client'

import type { ReactElement } from 'react'
import { PortalErrorScreen } from '../error'

/**
 * The order list, or the fulfilment page beneath it, failed to render.
 *
 * A BOUNDARY AT THIS SEGMENT RATHER THAN NONE, AND HERE IS THE HONEST ACCOUNT OF WHAT IT
 * BUYS. Without this file Next walks up to app/error.tsx, which renders the same words —
 * so nothing a patient READS changes. What changes is the scope of the recovery: `reset()`
 * on a segment boundary re-renders `/orders` and what is under it, while the root boundary
 * replaces everything below the root layout. On the two screens in this segment the retry
 * is the whole point of the screen — one read that did not come back — so keeping it local
 * is worth the four lines.
 *
 * `'use client'` AND `{ error, reset }` ARE THE FRAMEWORK CONTRACT, NOT A PREFERENCE. Next
 * renders this as the fallback of a React error boundary, and an error boundary catches at
 * render time in the browser; there is no server-rendered variant of this file to reach for.
 *
 * `section="generic"` BECAUSE THE GENERIC WORDS ARE ALREADY THE RIGHT ONES HERE, and using
 * them is a decision rather than a default. This segment is behind a session, so "Go to
 * your care" leads somewhere the reader can actually get to — which is precisely the test
 * consent/error.tsx applies when it argues that the generic screen is WRONG for a patient
 * who does not have an account yet. The other sections do not fit: this is not booking, it
 * is not the payment attempt itself, and a bespoke sentence about orders would have to
 * claim something about the order's state, which a page that failed before reading anything
 * does not know.
 *
 * WHAT THIS SCREEN MUST NOT DO IS IMPLY ANYTHING ABOUT MONEY. A patient reaching it may
 * have been on their way to pay. The generic copy says only that nothing has been changed
 * and nothing has been lost, which is true — this segment performs no write — and it must
 * stay that way: a sentence here that mentioned payment would be a page speculating about a
 * transaction it never read.
 *
 * Nothing from the error object is rendered except `digest` — see app/error.tsx.
 */
export default function OrdersError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return <PortalErrorScreen section="generic" error={error} reset={reset} />
}
