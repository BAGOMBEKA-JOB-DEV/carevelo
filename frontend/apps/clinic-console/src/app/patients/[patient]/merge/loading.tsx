import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * Merging a duplicate, in the shape it will arrive in.
 *
 * IT IS TWO READS DEEP, WHICH IS WHY IT EARNS A FALLBACK OF ITS OWN. The route reads the
 * surviving record, and `MergeScreen` then reads a page of the registry to choose a duplicate
 * from — and pages through it, so the wait happens again on every cursor. Without this file
 * the fallback Next reaches for is the record's, which reserves a grid of cards where a list
 * of candidate records is about to be.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here for real and costs
 * nothing, and why `active="patients"` has to be stated.
 *
 * THE HEADING IS REAL AND THE LINE UNDER IT IS NOT. "Merge a duplicate" is fixed; the
 * description is "Into {name} — the record that survives", which is the one sentence on this
 * screen that says WHICH WAY ROUND the merge goes. There is no way back from a merge — the
 * screen's own standing notice says exactly that — so a name in that position that turns out
 * to be the other record's is the most expensive thing a placeholder could get wrong
 * anywhere in this console. It is reserved and left empty until it is true.
 *
 * NOTHING BELOW SKETCHES A PATIENT. Every candidate on this screen is a real person's record,
 * and a placeholder that outlined "name / telephone / registered" is a shape somebody can
 * start reading before any of it is known. The list is reserved as one block: it reserves the
 * height, and the semantics and the names arrive together.
 *
 * THE CONFIRMATION STEP IS NOT RESERVED AT ALL. `?duplicate=` switches this screen from
 * choosing a record to comparing two of them side by side, and `loading.tsx` is passed no
 * search parameters. A fallback that drew the comparison would put two empty columns in front
 * of somebody about to perform an irreversible merge.
 */
export default function MergeLoading(): ReactElement {
  return (
    <ConsoleShell title="Merge a duplicate" active="patients">
      <Stack gap="6">
        <PageHeader title="Merge a duplicate" />

        {/* "There is no way back from this", and the note about finding the duplicate. Both
            are on the screen every time, so both are reserved — plain, because a tint here is
            how this console tells a warning from a note. */}
        <Skeleton block="sm" />

        {/* The search field over the registry. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} />
            <Skeleton block="sm" />
          </Stack>
        </Card>

        {/* The candidate records, and the cursor pager under them. */}
        <Card as="section">
          <Skeleton block="lg" />
        </Card>

        <Skeleton lines={1} />
      </Stack>
    </ConsoleShell>
  )
}
