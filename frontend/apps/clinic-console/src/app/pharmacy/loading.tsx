import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The dispensing queue, in the shape it will arrive in.
 *
 * THIS IS THE ROUTE THE FALLBACK MATTERS MOST ON IN THIS APP. `PharmacyQueueScreen` reads
 * five lanes in parallel and cannot render until all five have answered, so the wait is as
 * long as the slowest of them. Until this file existed a pharmacist pressing "Pharmacy" saw
 * the page they were already on, unchanged, for the whole of that wait — which on a bad
 * connection is indistinguishable from a click that did not register, and the honest
 * response to a click that did not register is to click again.
 *
 * FIVE LANES, because `LANE_IDS` in domains/dispensing/model/status.ts has five: received,
 * under review, awaiting substitution, paid, ready for pickup. The count is hard-coded
 * rather than imported, and deliberately: `LANE_IDS` is not part of the dispensing domain's
 * public surface — `domains/dispensing/index.ts` exports the screens and the queue reader,
 * not the lane model — and a route reaching past a domain's index to read its internals is
 * exactly the boundary this repo enforces in .dependency-cruiser.cjs. If a sixth lane is
 * added, this fallback is one card short for a second. That is a placeholder of the wrong
 * length, not a page of the wrong shape, and it is the cheaper of the two mistakes.
 *
 * The lane HEADINGS are not rendered for the same reason: they live in `LANES` beside
 * `LANE_IDS`. So each card reserves its heading rather than naming it.
 *
 * See patients/loading.tsx for why ConsoleShell is here and why the table area is one
 * block rather than a counterfeit table.
 */
export default function PharmacyLoading(): ReactElement {
  return (
    <ConsoleShell title="Pharmacy" active="pharmacy">
      <Stack gap="6">
        <PageHeader title="Pharmacy" />

        {/* The standing notice about a pending substitution blocking only its own item.
            It is above the lanes on every render of this screen, so its height is part of
            the shape even though its words are not this file's to repeat. */}
        <Skeleton block="sm" />

        {Array.from({ length: 5 }, (_unused, index) => (
          <Card key={index} as="section">
            <Stack gap="5">
              {/* The lane's heading and the sentence under it. */}
              <Stack gap="3">
                <Skeleton lines={1} />
                <Skeleton lines={1} />
              </Stack>
              {/* The orders in the lane: reference, state, arrived, total, open. */}
              <Skeleton block="md" />
            </Stack>
          </Card>
        ))}
      </Stack>
    </ConsoleShell>
  )
}
