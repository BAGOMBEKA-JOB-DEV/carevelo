import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { FieldShell } from '@/components/FieldShell'

/**
 * The round, in the shape it will arrive in.
 *
 * THE FRAME IS REAL BECAUSE IT COSTS NOTHING TO MAKE IT REAL. `FieldShell` is a
 * synchronous server component — a header, a `<main>` and two tab links — so a
 * `loading.tsx` can render it at full fidelity and the rider never sees the app's own
 * chrome disappear and come back. `active="assignments"` because this fallback IS the
 * assignments route and the highlighted tab must not move during the wait.
 *
 * THIS IS THE FALLBACK THAT MATTERS MOST IN THE PRODUCT. A rider opens this screen standing
 * in the street, on a handset, on whatever signal there is between two districts, and they
 * open it repeatedly — it is how they find out whether anything new has been assigned to
 * them. Before this file existed, every one of those taps left the previous screen on
 * display until the whole list had come back, which is indistinguishable from a tap that
 * did not register. The rider's response to a tap that did not register is another tap.
 *
 * THE HEADING IS REAL. "Assignments" is a fixed word, so the fallback has a true <h1> and a
 * screen reader landing here is told which screen it is on.
 *
 * NOTHING IN THE PLACEHOLDER RESEMBLES AN ADDRESS OR A NAME. Three grey bars are three grey
 * bars; the danger to avoid is a placeholder detailed enough that a rider starts reading a
 * round off it and sets out before the real list has arrived.
 */
export default function AssignmentsLoading(): ReactElement {
  return (
    <FieldShell active="assignments">
      <Stack gap="5">
        <PageHeader title="Assignments" />

        {Array.from({ length: 3 }, (_unused, index) => (
          <Card key={index}>
            <Stack gap="4">
              {/* The reference and the status badge, on one line. */}
              <Skeleton lines={1} />
              {/* The recipient's name, at heading size — `.title-lg` is the nearest step on
                  the type scale to the card's own <h2>, so the bar is the height of the
                  line it stands in for rather than the height of body text. */}
              <Skeleton lines={1} className="title-lg" />
              {/* Street, landmark, district, as one block of prose. */}
              <Skeleton lines={2} />
              {/* The full-width action. Reserved at block height because it is the thumb
                  target, and a target that arrives late arrives under a thumb already
                  moving towards where it used to be. */}
              <Skeleton block="sm" />
            </Stack>
          </Card>
        ))}
      </Stack>
    </FieldShell>
  )
}
