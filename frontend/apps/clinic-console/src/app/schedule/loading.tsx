import type { ReactElement } from 'react'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The day, held in place while it is read.
 *
 * NO HEADING, AND ON THIS ROUTE THAT IS UNAVOIDABLE RATHER THAN CAUTIOUS. `DayView`'s <h1>
 * is the day itself — "Today", or a written-out date — chosen from `?day=`. A `loading.tsx`
 * is given no props at all, so this file cannot know which day is being opened, and a
 * fallback that said "Today" above a page that resolved to the 3rd of next month would be
 * actively misleading to somebody moving through the week with the previous/next controls,
 * which is exactly how this screen is used.
 *
 * The shell still carries the word "Schedule" in the topbar and the highlighted tab, so the
 * page is not anonymous while it waits — it is only the DAY that is unknown.
 *
 * See patients/loading.tsx for why ConsoleShell is rendered here rather than skeletoned.
 */
export default function ScheduleLoading(): ReactElement {
  return (
    <ConsoleShell title="Schedule" active="schedule">
      <Stack gap="6">
        {/* The heading and the count under it — "4 appointments holding time". Reserved
            at heading size: `.title-lg` is the nearest step on the type scale to
            `.page-head h1`, so the bar is the height of the line it stands in for. */}
        <Stack gap="4">
          <Skeleton lines={1} className="title-lg" />
          <Skeleton lines={1} />
        </Stack>

        {/* Previous / next, the day itself, and the clinician filter. This card is the one
            control a member of staff reaches for FIRST on a slow load — they are usually
            navigating to a different day — so under-reserving it would move the target
            under a cursor that is already on its way. */}
        <Card>
          <Skeleton block="sm" />
        </Card>

        {/* The appointments. Four is a quiet morning; the number is a guess at a length and
            the row is the part that has to be the right shape. */}
        {Array.from({ length: 4 }, (_unused, index) => (
          <Card key={index}>
            <Stack gap="4">
              {/* The time, the patient, the service and the clinician. */}
              <Skeleton lines={2} />
              {/* The status badge and whatever the state allows — confirm, cancel, open
                  the consultation room. */}
              <Skeleton block="sm" />
            </Stack>
          </Card>
        ))}
      </Stack>
    </ConsoleShell>
  )
}
