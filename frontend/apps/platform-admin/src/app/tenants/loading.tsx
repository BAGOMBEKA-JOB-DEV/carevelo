import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'

/**
 * The register of clinics, in the shape it will arrive in.
 *
 * IT COVERS `/tenants/new` TOO, AND THAT IS DELIBERATE RATHER THAN AN OVERSIGHT. Next walks
 * up to the nearest `loading.tsx`, so the provisioning form inherits this fallback. The two
 * screens are not the same shape — one is a table, the other is a form — but they are both
 * a page head, a standing notice and one bordered panel, and the alternative is a second
 * file that reserves a form nobody waits on: `/tenants/new` reads the session and nothing
 * else, so its fallback is on screen for one round trip rather than two. Reserving roughly
 * the right height for a moment beats blanking the navigation, which is what happens with
 * no file here at all.
 *
 * See app/loading.tsx for why the frame is rendered for real and costs nothing, and for why
 * `error.tsx` makes the opposite choice.
 *
 * `active="tenants"` so the sidebar item and the mobile tab stay highlighted through the
 * wait. A fallback that dropped the highlight would move the one signal that says where you
 * are, at the exact moment you have just arrived somewhere.
 *
 * THE HEADING IS REAL AND ITS SENTENCE IS NOT. "Tenants" is what `sections.ts` calls this
 * section, what the topbar shows and what the screen's own <h1> says — one fixed word in
 * three places, so it is rendered rather than greyed. What is left out is
 * the lede, for a mechanical reason as much as an editorial one: `PageHeader` renders its
 * description inside a `<p>`, the HTML parser re-parents a `<div>` out of a `<p>`, and the
 * resulting hydration mismatch is a worse defect than one paragraph of movement.
 *
 * NOTHING BELOW SKETCHES A TABLE. A `<table>` of placeholder rows with invented `<th>`s
 * announces as a table with headings and no data — a promise about structure made before
 * any structure exists — and the register's table carries real `scope` on every header,
 * which is precisely the thing not to counterfeit. The block reserves the height; the
 * semantics arrive with the rows.
 *
 * AND NOTHING BELOW SKETCHES A CLINIC. Every row of this table is a named customer of
 * Carevelo's, and a placeholder that outlined "trading name / licence / status" would be a
 * shape an operator could start reading before any of it is true. Two undifferentiated
 * panels, and the register arrives into them.
 */
export default function TenantsLoading(): ReactElement {
  return (
    <ControlPlaneShell title="Tenants" active="tenants">
      <PageHeader title="Tenants" />

      <Stack gap="6">
        {/* The "Platform overview" link that opens every screen in this section. */}
        <Skeleton lines={1} />

        {/* The standing notice about what this register can and cannot answer — the
            sentence that says a clinic's patients are not reachable from this screen. It is
            on the page every time, so its height is reserved every time. */}
        <Skeleton block="sm" />

        {/* The filter toolbar: the status control and the export link, inside their own
            tight panel exactly as the screen renders them. */}
        <Card as="section" padding="tight">
          <Skeleton lines={1} />
        </Card>

        {/* The register itself, and under it the cursor pager. */}
        <Card as="section" padding="tight">
          <Skeleton block="lg" />
        </Card>

        <Skeleton lines={1} />
      </Stack>
    </ControlPlaneShell>
  )
}
