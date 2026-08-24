import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'

/**
 * The audit register, in the shape it will arrive in.
 *
 * THIS ROUTE GOT SLOWER WHEN IT BECAME REAL, which is why this file was rewritten rather
 * than deleted. It used to render three paragraphs after one round trip. It now resolves
 * the operator, then reads the clinic register AND a page of the audit trail, and only then
 * renders — and the audit read is a cross-tenant query against a partitioned table. Without
 * a fallback here Next walks up to `app/loading.tsx` and an operator clicking "Audit"
 * watches the OVERVIEW's placeholder — a stat card and a clinics-by-state row — resolve
 * into a table. A skeleton of the wrong page is worse than no skeleton.
 *
 * `active="audit"` is most of the value here: it is the only thing on screen during that
 * wait that tells an operator their click registered. See app/loading.tsx for why the frame
 * is rendered for real and costs nothing.
 *
 * ------------------------------------------------------------------------------------
 * NOTHING HERE SKETCHES AN EVENT, AN ACTOR OR A CLINIC.
 *
 * Every row on this screen names a clinic and an account, and half of them are Carevelo's
 * own break-glass grants. A placeholder that outlined "action / when / clinic / actor" is a
 * shape somebody starts reading before any of it is true, on a screen opened during an
 * incident. The blocks below reserve height and draw nothing that resembles a record — and
 * in particular nothing that resembles the "Withheld" badge, which is a claim about what
 * the API returned and this file has no basis for making it.
 *
 * THE BADGE IN THE PAGE HEAD IS NOT RENDERED EITHER. It says whether the platform trail or
 * a clinic's is being read, which is the single most important fact on the screen; a grey
 * rectangle in that position is a trail name to anybody glancing.
 * ------------------------------------------------------------------------------------
 */
export default function AuditLoading(): ReactElement {
  return (
    <ControlPlaneShell title="Audit" active="audit">
      <PageHeader title="Audit" />

      <Stack gap="6">
        {/* The two links that open the section: the overview and the break-glass register. */}
        <Skeleton lines={1} />

        {/* The two standing notices — what the register withholds, and that reading it is
            itself audited. Both are unconditional on this route, so both have their height
            reserved unconditionally. */}
        <Skeleton block="sm" />
        <Skeleton block="sm" />

        {/* The filter bar: the trail picker, the action, the actor and the two dates. */}
        <Card as="section" padding="tight">
          <Skeleton block="sm" />
        </Card>

        {/* The register itself. One block, not a striped table: rows drawn here would be
            read as rows. */}
        <Card as="section" padding="tight">
          <Skeleton block="lg" />
        </Card>

        {/* The cursor pager under it. */}
        <Skeleton lines={1} />
      </Stack>
    </ControlPlaneShell>
  )
}
