import type { ReactElement } from 'react'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { FieldShell } from '@/components/FieldShell'

/**
 * One delivery, held in place while it is read.
 *
 * NO HEADING, AND HERE THAT IS THE CAREFUL CHOICE RATHER THAN A LIMITATION. The screen's
 * heading is the recipient's name. `loading.tsx` is given no props — not the route
 * parameter — so this file cannot know it, and it must not put a convincing bar where a
 * person's name goes on a screen a rider is about to act on. The name arrives when the name
 * is true.
 *
 * The shell stays (see assignments/loading.tsx for why that is free), so the tab bar and
 * the way back to the round are on screen for the whole wait — which on this route is the
 * thing a rider most often wants when the delivery they tapped is not the one they meant.
 */
export default function DeliveryLoading(): ReactElement {
  return (
    <FieldShell active="assignments">
      <Stack gap="5">
        {/* The reference and the status. */}
        <Skeleton lines={1} />
        {/* Where the recipient's name will be. */}
        <Skeleton lines={1} className="title-lg" />

        {/* The address block and the call button. */}
        <Card>
          <Stack gap="4">
            <Skeleton lines={2} />
            <Skeleton block="sm" />
          </Stack>
        </Card>

        {/* What the rider can record from here — picked up, en route, delivered, failed. */}
        <Card>
          <Skeleton block="md" />
        </Card>
      </Stack>
    </FieldShell>
  )
}
