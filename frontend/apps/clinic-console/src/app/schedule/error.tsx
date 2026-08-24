'use client'

import type { ReactElement } from 'react'
import { Button } from '@carevelo/ui'
import { ConsoleErrorScreen } from '../error'

/**
 * A schedule screen that could not be built.
 *
 * WHY THIS SECTION GETS ITS OWN BOUNDARY. Every other failed console screen is an
 * interruption for the person looking at it. This one is an interruption with a caller on the
 * telephone: /schedule/book is worked through while somebody is listening, and a receptionist
 * whose screen breaks after pressing "Book" has no way of knowing whether the slot was taken.
 * The instinct is to take it again. A patient booked twice holds two of the clinic's times,
 * one of which nobody attends and the clinic cannot resell — and the second booking generates
 * a second message to the patient, who now does not know which time is theirs.
 *
 * SO THE COPY SENDS THEM TO THE DAY BEFORE IT SENDS THEM ANYWHERE ELSE. The day view is the
 * only place on this surface where the answer is true, and it is one click from here. The
 * consultation room is under this section too and fails the same way — a room that will not
 * open is not a consultation that has been cancelled, and the copy is careful not to imply it
 * has been.
 *
 * `reset()` is safe on every route under /schedule: these are reads. Booking, confirming and
 * cancelling are Server Actions, and re-rendering the page an action was invoked from does not
 * replay the action, so the retry cannot take, confirm or release a time.
 *
 * NOTHING ABOUT THE PATIENT OR THE APPOINTMENT APPEARS HERE, and no clinical content can:
 * this component cannot reach a booking, so there is no branch below where a service, a
 * clinician or a note could be rendered. `error.message` on this section carries an
 * appointment identifier and frequently a patient's name; it is never rendered and never
 * logged from here. See the parent boundary for the whole rule and for why `error.digest` is
 * the one exception to it.
 */
export default function ScheduleError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return (
    <ConsoleErrorScreen
      title="The schedule did not load"
      error={error}
      reset={reset}
      actions={
        <>
          <Button variant="quiet" size="lg" href="/schedule">
            Open the day
          </Button>
          <Button variant="ghost" size="lg" href="/patients">
            Go to patients
          </Button>
        </>
      }
    >
      This page failed before it could read anything, so nothing on it tells you what is
      booked, or whether a booking you had just taken went through. If you were on a call, open
      the day and look before you take the time again — a patient booked twice holds two of the
      clinic&rsquo;s appointments and is sent two messages. Nothing has been cancelled by this.
    </ConsoleErrorScreen>
  )
}
