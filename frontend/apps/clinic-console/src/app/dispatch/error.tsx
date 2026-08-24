'use client'

import type { ReactElement } from 'react'
import { Button } from '@carevelo/ui'
import { ConsoleErrorScreen } from '../error'

/**
 * A dispatch screen that could not be built.
 *
 * WHY THIS SECTION GETS ITS OWN BOUNDARY. A dispatcher who cannot see the board and has an
 * order in front of them creates the delivery again. Two deliveries for one order is two
 * riders sent to one address for one package: the second arrives at somebody's home,
 * announces themselves, and has nothing to hand over. The clinic pays for both trips, and the
 * patient has had a stranger at their gate holding a package they have already received.
 *
 * SO THE COPY SAYS TO READ THE BOARD BEFORE CREATING ANYTHING. The board is the only place on
 * this surface where the answer is actually true, and every route under /dispatch — the
 * lanes, one delivery, the create form — fails for the same reason and recovers the same way.
 *
 * `reset()` is safe here: these are reads. Creating a delivery, assigning a rider and
 * recording a status are Server Actions, and re-rendering the page an action was invoked from
 * does not replay the action, so the retry cannot dispatch anybody.
 *
 * NOTHING ABOUT THE RECIPIENT OR THE PACKAGE APPEARS HERE, and there is nothing in this
 * component that could render one. That is the same rule the rider payload is built on: a
 * delivery's identifiers do not travel further than the screen that needs them, and an error
 * screen is further. `error.message` on this section carries a delivery identifier in a
 * request URL and often an address; it is never rendered and never logged from here. See the
 * parent boundary for the whole rule and for why `error.digest` is the one exception.
 */
export default function DispatchError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return (
    <ConsoleErrorScreen
      title="The dispatch screen did not load"
      error={error}
      reset={reset}
      actions={
        <>
          <Button variant="quiet" size="lg" href="/dispatch">
            Back to the board
          </Button>
          <Button variant="ghost" size="lg" href="/pharmacy">
            Go to the pharmacy queue
          </Button>
        </>
      }
    >
      This page failed before it could read anything, so nothing on it tells you whether a
      delivery exists for an order, who it is assigned to, or where it has got to. Do not
      create a delivery or assign a rider on the strength of this screen — a second delivery
      for one order sends a second rider to somebody&rsquo;s home with nothing to hand over.
      Try once more, and check the board before you create anything.
    </ConsoleErrorScreen>
  )
}
