'use client'

import type { ReactElement } from 'react'
import { Button } from '@carevelo/ui'
import { ConsoleErrorScreen } from '../error'

/**
 * A dispensing screen that could not be built.
 *
 * THIS IS THE HIGHEST-CONSEQUENCE FAILURE SCREEN IN THE CONSOLE, and it earns its own
 * boundary for one reason: the thing a pharmacist does when a screen breaks halfway through
 * dispensing is dispense it again. Medicine handed over twice is not a page that has to be
 * reloaded. It is a patient holding double the quantity they were prescribed, with nothing
 * on the record to say why, and the clinic finds out — if it finds out — at a stock count.
 *
 * SO THE COPY STATES THE ONE FACT THE SCREEN ACTUALLY HAS: it failed before it read anything,
 * so it is evidence of nothing in either direction. Not that the order was dispensed, not
 * that it was not. And it names the correct next action, which is to open the order itself
 * and read its state before touching any medicine — never to repeat the step from memory.
 *
 * `reset()` is safe on every route under /pharmacy: these are reads. Marking an order
 * dispensed is a Server Action, and re-rendering the page an action was invoked from does not
 * replay the action, so pressing the retry cannot dispense anything.
 *
 * NO CLINICAL CONTENT, AND NONE TO LEAK. This component cannot reach an order, so there is no
 * branch below where a medicine, a quantity or a prescriber could appear — which is the point
 * of keeping `error.message` off the screen in the first place: on this section it carries
 * exactly those. The copy also never names what was being dispensed, because a sentence about
 * a prescription already says a prescription exists, and the pharmacy counter is not a
 * private room.
 *
 * See the parent boundary for the digest rule and for why this file renders no `ConsoleShell`.
 */
export default function PharmacyError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return (
    <ConsoleErrorScreen
      title="The dispensing screen did not load"
      error={error}
      reset={reset}
      actions={
        <>
          <Button variant="quiet" size="lg" href="/pharmacy">
            Back to the queue
          </Button>
          <Button variant="ghost" size="lg" href="/schedule">
            Go to the schedule
          </Button>
        </>
      }
    >
      This page failed before it could read anything, so nothing on it tells you the state of
      any order — not that one was dispensed, and not that one was not. Do not hand anything
      over or repeat a step on the strength of this screen. Try once more, and if it still will
      not open, find the order in the queue and read its state before you touch the medicine.
    </ConsoleErrorScreen>
  )
}
