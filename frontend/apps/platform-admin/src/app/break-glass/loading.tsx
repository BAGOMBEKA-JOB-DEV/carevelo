import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'

/**
 * The break-glass register, in the shape it will arrive in.
 *
 * It overrides the root fallback for the same reason tenants/loading.tsx does: so the
 * highlighted tab stays on this section while the screen loads.
 *
 * THE COUNT OF OPEN GRANTS IS THE FIGURE THIS PAGE EXISTS FOR, and it is reserved as a
 * block rather than sketched. Nothing in this placeholder resembles a number — an operator
 * glancing at a grey rectangle cannot misread it as "0 open grants", which on this screen
 * would be the most consequential thing a placeholder could get wrong.
 */
export default function BreakGlassLoading(): ReactElement {
  return (
    <ControlPlaneShell title="Break-glass" active="break-glass">
      <Stack gap="6">
        <PageHeader title="Break-glass" />

        <Skeleton lines={1} />

        {/* The count, and the paragraph that explains what it means. */}
        <Card as="section">
          <Skeleton block="md" />
        </Card>

        {/* Open right now. */}
        <Stack gap="5">
          <Skeleton lines={1} />
          <Card>
            <Skeleton block="md" />
          </Card>
        </Stack>

        {/* Request a grant — the longest form on this surface. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} />
            <Skeleton block="lg" />
          </Stack>
        </Card>

        {/* The register itself. */}
        <Stack gap="5">
          <Skeleton lines={1} />
          <Card>
            <Skeleton block="lg" />
          </Card>
        </Stack>
      </Stack>
    </ControlPlaneShell>
  )
}
