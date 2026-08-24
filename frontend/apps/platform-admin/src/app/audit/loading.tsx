import type { ReactElement } from 'react'
import { Card, Grid, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'

/**
 * Audit, in the shape it will arrive in.
 *
 * THE SHORTEST WAIT IN THE APP, AND STILL WORTH A FILE. Everything on this route is static
 * — `PlannedSection` renders words out of `sections.ts` and fetches nothing — but the page
 * above it awaits `authoriseOperator()` before it renders any of them, so there is exactly
 * one round trip during which nothing on screen changes. Without a fallback here Next walks
 * up to `app/loading.tsx`, and an operator clicking "Audit" would watch the OVERVIEW's
 * placeholder — a stat card and a clinics-by-state row — resolve into three paragraphs
 * about audit metadata, with the sidebar highlight sitting on nothing the whole time. A
 * skeleton of the wrong page is worse than no skeleton, and the fix is a small file rather
 * than a compromise in the shared one.
 *
 * `active="audit"` is most of the value here: it is the only thing on screen during that
 * round trip that tells an operator their click registered.
 *
 * See app/loading.tsx for why the frame is rendered for real and costs nothing.
 *
 * THE HEADING IS REAL, and unusually there is no argument to have about it: "Audit" is the
 * section's label in `sections.ts`, the topbar's title and the page's <h1>, and none of the
 * three depends on anything fetched.
 *
 * WHAT IS NOT RENDERED IS THE "Not built yet" BADGE. It sits in the page head's actions
 * slot and it is a statement about the state of the product; a fallback has no business
 * making that statement a moment before the page makes it properly, and a grey rectangle
 * where a badge goes is a badge to anybody glancing.
 */
export default function AuditLoading(): ReactElement {
  return (
    <ControlPlaneShell title="Audit" active="audit">
      <PageHeader title="Audit" />

      <Stack gap="5">
        {/* The standing notice that nothing on this screen works yet, and under it the
            caution about metadata-only reads of a clinic's events. Both are unconditional
            on this route, so both have their height reserved. */}
        <Skeleton block="sm" />
        <Skeleton block="sm" />

        {/* The three planned screens, in the two-column grid that collapses to one at the
            same width the real one does. */}
        <Grid cols={2} gap="5">
          {Array.from({ length: 3 }, (_unused, index) => (
            /* Index as key: generated from a count, never reordered, no state to carry. */
            <Card key={index}>
              <Stack gap="3">
                <Skeleton lines={1} className="title-sm" />
                <Skeleton lines={3} />
              </Stack>
            </Card>
          ))}
        </Grid>
      </Stack>
    </ControlPlaneShell>
  )
}
