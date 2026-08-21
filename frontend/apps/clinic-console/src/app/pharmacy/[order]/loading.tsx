import type { ReactElement } from 'react'
import { Card, Grid, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * One dispense order, held in place while it is read.
 *
 * IT EXISTS SEPARATELY FROM `pharmacy/loading.tsx` BECAUSE THE SHAPES DISAGREE. Without
 * this file Next walks up to the queue's fallback, and a pharmacist clicking a row would
 * watch FIVE lane cards resolve into one order — a placeholder that is not the shape of
 * what follows promises a layout and then breaks it, which is worse than no placeholder at
 * all. The queue is a board; an order is two panels and a table.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here rather than skeletoned,
 * and why it costs nothing to do so.
 *
 * ------------------------------------------------------------------------------------
 * NO HEADING, AND ON THIS ROUTE THAT IS THE POINT RATHER THAN A GAP.
 *
 * `OrderScreen`'s <h1> is the ORDER REFERENCE and the line under it is what the current
 * status means. A `loading.tsx` is passed no props — not the route parameter, not the
 * search parameters — so this file knows neither, and a plausible-looking bar where a
 * reference goes is an invitation to start reading the screen as though the right order had
 * opened. A pharmacist works from that reference against a printed label. It is reserved
 * and left empty until it is true.
 *
 * NOTHING BELOW SKETCHES A MEDICINE, A QUANTITY OR A PRICE either. The dispensed-items
 * table is where a substitution, a controlled-medicine flag and a unit price live, and a
 * skeleton that outlined its columns would be a shape somebody could read a count off
 * before any of it existed. On this surface that is the wrong direction to be wrong in.
 * ------------------------------------------------------------------------------------
 *
 * WHAT IS RESERVED ABOVE THE PANELS is the room a standing notice takes. This order may
 * open with a controlled-medicine refusal or a pharmacy rejection at the top of it, and
 * both are the first thing on the screen when they apply. Leaving that band unreserved
 * would mean the two panels below arrive, settle, and then get shoved down by a red notice
 * at the moment the pharmacist has started reading them.
 */
export default function OrderLoading(): ReactElement {
  return (
    <ConsoleShell title="Pharmacy" active="pharmacy">
      <Stack gap="6">
        {/* The page head: the reference at heading size, the status meaning under it, and
            the status badge beside them. All three arrive with the order. */}
        <Stack gap="3">
          <Skeleton lines={1} className="title-lg" />
          <Skeleton lines={1} />
        </Stack>

        {/* Whichever standing notice this order carries, if it carries one. */}
        <Skeleton block="sm" />

        {/* "Total" and "Handover", side by side. `Grid cols={2}` collapses to one column at
            700px, which is where the real pair collapses, so the fallback and the page
            agree about how many panels are beside each other at every width. */}
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
              <Skeleton block="sm" />
            </Stack>
          </Card>
        </Grid>

        {/* "What was dispensed" — the tallest thing on the screen and the part that arrives
            last. One block rather than a counterfeit table: a `<table>` of placeholder rows
            with invented `<th>`s announces as a table with headings and no data, and this
            project's tables carry real `scope`, which is precisely the thing not to fake. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="lg" />
          </Stack>
        </Card>
      </Stack>
    </ConsoleShell>
  )
}
