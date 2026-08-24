import type { ReactElement } from 'react'
import { Card, Inline, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * A day's reconciliation, held in place while it is read.
 *
 * THIS ONE IS SLOW BY NATURE, which is why it has its own fallback rather than inheriting
 * the section's. It reads every payment attempt recorded for a day and counts the ones that
 * need a look, and it is opened by somebody who has just changed the date — so the wait
 * happens on a deliberate action, repeatedly, and a screen that does not visibly respond to
 * a date change invites a second one.
 *
 * THE HEADING IS REAL. "Reconciliation" is a fixed word. What is NOT rendered is the day:
 * the date lives in `?date=`, `loading.tsx` receives no props, and a placeholder date on a
 * reconciliation screen is the one thing on it that must never be approximate.
 *
 * The two figures — how many records, how many need a look — are reserved as a pair of
 * blocks in the row they will occupy. They are the numbers this page exists for, and if
 * their row is not reserved the table under them jumps at the moment somebody is reading
 * them.
 *
 * See patients/loading.tsx for why ConsoleShell is here and why the table is one block
 * rather than a counterfeit table with invented headings.
 */
export default function ReconciliationLoading(): ReactElement {
  return (
    <ConsoleShell title="Payments" active="payments">
      <Stack gap="6">
        <PageHeader title="Reconciliation" />

        <Skeleton lines={1} />
        <Skeleton block="sm" />

        {/* "Pick a day": the date field and the flagged-only checkbox. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} />
            <Skeleton block="sm" />
          </Stack>
        </Card>

        <Card as="section">
          <Stack gap="5">
            {/* The day's heading and the two counts beside it. */}
            <Inline gap="7" justify="between" align="start">
              <Skeleton lines={1} className="grow" />
              <Skeleton block="sm" className="grow" />
            </Inline>
            {/* Reference, aggregator reference, amount, state, flags. */}
            <Skeleton block="lg" />
          </Stack>
        </Card>
      </Stack>
    </ConsoleShell>
  )
}
