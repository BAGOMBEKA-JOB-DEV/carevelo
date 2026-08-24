import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The delivery board, in the shape it will arrive in.
 *
 * The same argument as pharmacy/loading.tsx and the same structure: `DispatchBoardScreen`
 * reads its lanes in parallel and renders nothing until the slowest answers, so without a
 * fallback a dispatcher waits on a page that has not visibly changed.
 *
 * SIX LANES, because `LANE_IDS` in domains/delivery/model/status.ts has six: unassigned,
 * assigned, picked up, en route, failed, returned to pharmacy. Hard-coded rather than
 * imported, for the boundary reason set out in pharmacy/loading.tsx — the delivery domain's
 * index exports the screens and the lane reader, not the lane model — and with the same
 * consequence if it drifts: a placeholder one card short, not a page of the wrong shape.
 *
 * THERE IS AN EXTRA CARD ABOVE THE LANES on this route: the orders that are dispensed and
 * waiting to have a delivery created at all. It is reserved separately because it is not
 * one of the six.
 *
 * See patients/loading.tsx for why ConsoleShell is here.
 */
export default function DispatchLoading(): ReactElement {
  return (
    <ConsoleShell title="Dispatch" active="dispatch">
      <Stack gap="6">
        <PageHeader title="Dispatch" />

        {/* The standing notice about the two refusals that have no override — the
            controlled-substance exclusion and delivery consent. */}
        <Skeleton block="sm" />

        {/* Awaiting dispatch. */}
        <Card as="section">
          <Stack gap="5">
            <Skeleton lines={1} />
            <Skeleton block="md" />
          </Stack>
        </Card>

        {Array.from({ length: 6 }, (_unused, index) => (
          <Card key={index} as="section">
            <Stack gap="5">
              <Stack gap="3">
                <Skeleton lines={1} />
                <Skeleton lines={1} />
              </Stack>
              <Skeleton block="md" />
            </Stack>
          </Card>
        ))}
      </Stack>
    </ConsoleShell>
  )
}
