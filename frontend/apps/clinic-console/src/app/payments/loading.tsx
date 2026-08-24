import type { ReactElement } from 'react'
import { Card, Grid, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The money desk, in the shape it will arrive in.
 *
 * `title="Payments"` in the shell and `"Money desk"` as the heading, which is not an
 * inconsistency: `sections.ts` names the SECTION "Payments" and the screen inside it is the
 * money desk, and both strings are fixed, so both are rendered rather than greyed.
 *
 * See patients/loading.tsx for why ConsoleShell is here, and for why the lede under the
 * heading is not reserved.
 */
export default function PaymentsLoading(): ReactElement {
  return (
    <ConsoleShell title="Payments" active="payments">
      <Stack gap="6">
        <PageHeader title="Money desk" />

        {/* The nav across the desk, the records, the messages and the audit trail. */}
        <Skeleton lines={1} />

        {/* The standing notice this section carries on every screen. */}
        <Skeleton block="sm" />

        {/* "Open a payment record": a label, a field and a button. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} />
            <Skeleton block="sm" />
          </Stack>
        </Card>

        {/* Three explanatory cards across. `Grid cols={3}` collapses to two at 1080px and
            to one at 700px, which is where the real row collapses, so the fallback and the
            page agree about the column count at every width. */}
        <Grid cols={3}>
          {Array.from({ length: 3 }, (_unused, index) => (
            <Card key={index}>
              <Stack gap="4">
                <Skeleton lines={1} />
                <Skeleton lines={3} />
              </Stack>
            </Card>
          ))}
        </Grid>
      </Stack>
    </ConsoleShell>
  )
}
