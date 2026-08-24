'use client'

import type { ReactElement } from 'react'
import { PortalErrorScreen } from '../../error'

/**
 * The consultation page failed, and the recovery genuinely differs.
 *
 * THE HARM HERE IS SOMEBODY GIVING UP AND WALKING AWAY. Every other failed page in this
 * portal costs a patient a minute. This one costs them the appointment: a clinician is
 * holding a slot at a fixed time, the patient is the only party who can see that this
 * screen has broken, and a broken page a few minutes before a consultation reads as "it is
 * cancelled" to anybody who is not sure the booking worked in the first place. They stop
 * waiting. The clinician records a no-show against a patient who was sitting there.
 *
 * SO THE COPY SAYS THE THING THE SCREEN ACTUALLY KNOWS: the appointment is unchanged and
 * this page has cancelled nothing. It does not reassure beyond that — this component reads
 * nothing, so it cannot claim the consultation is ready — and it names the telephone call
 * as the next action, because the clinic is the only party who can see both sides.
 *
 * THE GENERIC BOUNDARY WOULD HAVE OFFERED "Go to your care", WHICH IS A DEAD END HERE. The
 * hub does not say where a consultation stands and does not put anybody back in a room. The
 * appointment list does, so that is the way out this section offers.
 *
 * NOTHING CLINICAL, AND NOTHING THAT NAMES THE APPOINTMENT. This component cannot reach the
 * consultation — no clinician's name, no service, no note, no reference. `error.message`
 * would carry the appointment identifier and is never rendered; see app/error.tsx for the
 * whole of that rule and for why `error.digest` is the one exception.
 *
 * `reset()` re-renders the segment. Entering the room is a Server Action and re-rendering
 * the page an action was invoked from does not replay it, so the retry cannot spend the
 * entry pass or announce an arrival twice.
 */
export default function ConsultationError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return <PortalErrorScreen section="consultation" error={error} reset={reset} />
}
