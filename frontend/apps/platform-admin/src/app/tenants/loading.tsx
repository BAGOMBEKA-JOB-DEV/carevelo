import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'

/**
 * The clinic register, in the shape it will arrive in.
 *
 * IT OVERRIDES THE ROOT FALLBACK so that the highlighted tab is right during the wait:
 * `app/loading.tsx` passes `active={null}` because the overview is not a section, and
 * inheriting that here would un-highlight "Tenants" for as long as the register took to
 * load. The tab is part of the frame, and a frame that flickers is a frame nobody trusts.
 *
 * THE HEADING IS REAL. "Tenants" is a fixed word, so the fallback carries a true <h1> and a
 * screen reader landing here is told which screen it is on rather than meeting an
 * unlabelled document.
 *
 * WHY THE TABLE IS ONE BLOCK AND NOT A SKELETON TABLE. A `<table>` of placeholder rows with
 * invented `<th>`s announces as a table with headings and no data — a promise about
 * structure made before any structure exists, on a surface whose tables carry real `scope`.
 * The block reserves the height; the semantics arrive with the rows.
 */
export default function TenantsLoading(): ReactElement {
  return (
    <ControlPlaneShell title="Tenants" active="tenants">
      <Stack gap="6">
        <PageHeader title="Tenants" />

        {/* The link back to the overview and the provisioning action beside it. */}
        <Skeleton lines={1} />

        {/* The status filter. */}
        <Card as="section" padding="tight">
          <Skeleton block="sm" />
        </Card>

        {/* Clinic, subdomain, state, trial ends, district, open. */}
        <Card as="section" padding="tight">
          <Skeleton block="lg" />
        </Card>
      </Stack>
    </ControlPlaneShell>
  )
}
