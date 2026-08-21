import type { ReactElement } from 'react'
import { Card, Grid, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'

/**
 * Audit, in the shape it will arrive in.
 *
 * IT OVERRIDES THE ROOT FALLBACK so the highlighted tab stays on this section during the
 * wait — the same reason tenants/loading.tsx and break-glass/loading.tsx do.
 *
 * THERE IS SOMETHING TO WAIT FOR HERE EVEN THOUGH THE SCREEN IS A PLACEHOLDER. `/audit`
 * renders `PlannedSection`, which reads nothing — but the route authorises the operator
 * first, and that is a round trip to the API. The page's own comment makes the point that
 * the authorisation is real even though the screen is not, and the wait is real with it.
 *
 * SO THE SHAPE IS `PlannedSection`'S: a heading, the standing notice about what is not
 * built yet, and the two-column grid of planned screens. The card COUNT is not knowable
 * from here — it comes from `components/sections.ts`, which the shell reads and this file
 * does not — so four is a shape rather than a claim.
 */
export default function AuditLoading(): ReactElement {
  return (
    <ControlPlaneShell title="Audit" active="audit">
      <Stack gap="6">
        <PageHeader title="Audit" />

        {/* The notice that says what is and is not here yet. */}
        <Skeleton block="sm" />

        <Grid cols={2} gap="5">
          {Array.from({ length: 4 }, (_unused, index) => (
            <Card key={index} as="section">
              <Stack gap="3">
                <Skeleton lines={1} />
                <Skeleton lines={2} />
              </Stack>
            </Card>
          ))}
        </Grid>
      </Stack>
    </ControlPlaneShell>
  )
}
