import type { ReactElement } from 'react'
import { Card, Grid, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * One delivery, held in place while it is read.
 *
 * IT EXISTS SEPARATELY FROM `dispatch/loading.tsx` FOR THE SAME REASON `pharmacy/[order]`
 * does: the board's fallback is seven cards of lanes, and this screen is two panels. A
 * dispatcher clicking a delivery would otherwise watch a board resolve into a record, which
 * is a promise about the layout that the page then breaks.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here rather than skeletoned.
 *
 * ------------------------------------------------------------------------------------
 * NO HEADING, DELIBERATELY. `DeliveryScreen`'s <h1> is the DELIVERY REFERENCE and the line
 * under it is what the status means. `loading.tsx` receives no props, so this file cannot
 * know either, and a plausible bar where the reference goes lets a dispatcher start reading
 * the screen as though the right record had opened — on a board where several deliveries
 * are in flight at once and the reference is the only thing distinguishing them.
 *
 * AND NOTHING BELOW SKETCHES AN ADDRESS OR A RECIPIENT. "What the rider sees" is a name, a
 * telephone number and a street; it is the smallest amount of a patient's information that
 * gets a delivery to a door, and a placeholder that outlined its rows would be a shape
 * somebody could start reading before any of it is true. The blocks reserve height and draw
 * nothing that resembles a person.
 * ------------------------------------------------------------------------------------
 */
export default function DeliveryLoading(): ReactElement {
  return (
    <ConsoleShell title="Dispatch" active="dispatch">
      <Stack gap="6">
        {/* The page head: the reference, the status meaning, the status badge. */}
        <Stack gap="3">
          <Skeleton lines={1} className="title-lg" />
          <Skeleton lines={1} />
        </Stack>

        {/* The room a failure notice takes when this delivery has one. Reserved rather than
            omitted, so the panels below do not settle and then get pushed down by it. */}
        <Skeleton block="sm" />

        {/* "What the rider sees" and "What the patient is being told", side by side.
            `Grid cols={2}` collapses to one column at 700px, where the real pair does. */}
        <Grid cols={2}>
          <Card as="section">
            <Stack gap="4">
              <Skeleton lines={1} className="title-sm" />
              <Skeleton lines={4} />
            </Stack>
          </Card>

          <Card as="section">
            <Stack gap="4">
              <Skeleton lines={1} className="title-sm" />
              <Skeleton block="md" />
            </Stack>
          </Card>
        </Grid>

        {/* The assignment control and the standing note that statuses come from the rider
            rather than from this screen. Both are on the page every time. */}
        <Skeleton block="sm" />
      </Stack>
    </ConsoleShell>
  )
}
