import type { ReactElement } from 'react'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { FieldShell } from '@/components/FieldShell'

/**
 * One delivery, held in place while it is read.
 *
 * IT EXISTS SEPARATELY FROM `assignments/loading.tsx` BECAUSE THE SHAPES ARE NOT THE SAME.
 * Without this file Next would walk up to the list's fallback, and a rider tapping "Open"
 * on a delivery would watch three placeholder CARDS resolve into one address panel — a
 * skeleton that is not the shape of what follows is worse than none, because it promises a
 * layout and then breaks it.
 *
 * THIS IS ALSO THE SLOWEST TAP ON THE SURFACE. The route reads the session and then the
 * delivery, one after the other, and it is tapped at the roadside on whatever signal there
 * is. It is the screen that holds the address the rider is riding to.
 *
 * ------------------------------------------------------------------------------------
 * NO HEADING, AND ON THIS ROUTE THAT IS THE POINT RATHER THAN A GAP.
 *
 * `DeliveryScreen`'s <h1> is the RECIPIENT'S NAME and its subtitle is the package
 * reference. A `loading.tsx` is passed no props — not the route parameter, not the search
 * parameters — so this file cannot know either of them, and it must not put a
 * plausible-looking bar where a person's name goes and let a rider start reading the screen
 * as though the right delivery had opened. On a round of five deliveries the difference
 * between the right name and a grey bar is the difference between handing a package to the
 * right household and to a neighbour.
 *
 * So the line is reserved and left empty. The shell still carries "Deliveries" in the
 * topbar and keeps the assignments tab highlighted, so the screen is not anonymous while it
 * waits — it is only the DELIVERY that is unknown, which is exactly true.
 * ------------------------------------------------------------------------------------
 *
 * See assignments/loading.tsx for why the frame is rendered for real rather than
 * skeletoned, and why that costs nothing.
 */
export default function DeliveryLoading(): ReactElement {
  return (
    <FieldShell active="assignments">
      {/* The page head: the recipient's name at heading size, the reference under it, and
          the status badge beside them. All three arrive with the record; all three are
          reserved rather than guessed. */}
      <Stack gap="4">
        <Skeleton lines={1} className="title-lg" />
        <Skeleton lines={1} />
      </Stack>

      <Stack gap="5">
        {/* "Deliver to" — the address, the landmark and the district, which is the block a
            rider actually reads and the tallest thing on the screen. */}
        <Card>
          <Stack gap="3">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton lines={3} />
          </Stack>
        </Card>

        {/* "Recipient" — the name again and the telephone control beside it. */}
        <Card>
          <Stack gap="3">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="sm" />
          </Stack>
        </Card>

        {/*
         * The one action the current status allows — collected, on the way, delivered —
         * rendered as a full-width 52px button at the bottom of the column where the thumb
         * already is. Its row is reserved on its own rather than folded into the card above
         * it, because it is the control the rider is reaching for, and a control that
         * arrives by pushing the page around under a moving thumb is a status recorded by
         * accident.
         */}
        <Skeleton block="sm" />
      </Stack>

      {/* The sign-out row, last on every route in this app. */}
      <Skeleton lines={1} />
    </FieldShell>
  )
}
