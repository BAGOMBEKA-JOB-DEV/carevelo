import type { ReactElement } from 'react'
import { Card, Grid, Inline, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'

/**
 * The overview, in the shape it will arrive in.
 *
 * IT IS THE ROOT FALLBACK AND IT IS ALSO THE OVERVIEW'S OWN, which is only true because
 * `/` is the overview. Next uses the nearest `loading.tsx` above the segment being
 * rendered, so this one stands in for the landing screen and for any future route that has
 * not been given its own; `/tenants`, `/break-glass` and `/audit` each have one, because
 * each of them also needs to keep its own navigation item highlighted.
 *
 * THE WHOLE FRAME IS REAL, NOT SKELETONED, AND THAT IS WHY `ControlPlaneShell` IS HERE.
 * The shell is a synchronous server component: it takes a title and a section and fetches
 * nothing, so a fallback can render the sidebar, the topbar and the mobile tab bar at full
 * fidelity for no cost at all. Without it, every navigation in this app would blank its own
 * navigation out and put it back a moment later. `error.tsx` beside this file makes the
 * opposite choice for the opposite reason — it is a client component, and the shell's
 * `sections.ts` is nine kilobytes of prose it would have to carry into the browser.
 *
 * `active={null}` because the overview is not one of the three nav sections — the page
 * itself passes `null` for exactly the same reason, and saying it out loud is how this
 * shell was made to stop lying about which item was current.
 *
 * BOTH STRINGS IN THE HEADER ARE REAL. "Platform admin" is the topbar's title on this route
 * and "Platform overview" is the page's own <h1>; neither depends on anything fetched. A
 * grey bar in their place would be pretending not to know something we know, and would
 * leave the fallback with no heading for a screen reader to land on.
 *
 * WHAT IS NOT RENDERED IS THE DATELINE — "Checked" and a timestamp, which sits in the page
 * head's actions slot. It is the one thing on this screen that says how fresh the figures
 * are, and a placeholder in its place would be a claim about freshness made before anything
 * has been read.
 *
 * NO FIGURE IS SKETCHED AS A FIGURE ANYWHERE BELOW. `Stat` renders a 28px display number,
 * and a grey rectangle at that size in the position of "Break-glass grants live now" is a
 * shape an operator can start reading before it is true. This screen exists to be glanced
 * at; the placeholders reserve height and deliberately draw nothing that resembles a count.
 */
export default function OverviewLoading(): ReactElement {
  return (
    <ControlPlaneShell title="Platform admin" active={null}>
      <PageHeader title="Platform overview" />

      <Stack gap="6">
        {/* The headline card: the live-grant figure beside the paragraph explaining what it
            is and is not evidence of, then the button through to the register. `Grid
            cols={2}` is what the real card uses and it collapses at the same width, so the
            fallback and the page agree at every viewport. */}
        <Card as="section">
          <Stack gap="5">
            <Grid cols={2} gap="6">
              <Skeleton block="sm" />
              <Skeleton lines={4} />
            </Grid>
            <Skeleton lines={1} />
          </Stack>
        </Card>

        {/* Row-level security, reported rather than assumed — one standing notice whose
            tone depends entirely on the answer, which is why nothing here is tinted. */}
        <Skeleton block="sm" />

        {/* Clinics by state. `Inline` rather than `Grid` for the same reason the screen
            uses one: the number of states is a fact only the API holds, and a fallback that
            hard-coded a column count would be asserting it. Five is today's count and is a
            guess at a length, not a claim about one. */}
        <Card as="section">
          <Stack gap="5">
            <Skeleton lines={1} className="title-sm" />
            <Inline gap="7" align="start">
              {Array.from({ length: 5 }, (_unused, index) => (
                /* Index as key: generated from a count, never reordered, no state. */
                <Skeleton key={index} lines={2} />
              ))}
            </Inline>
            <Skeleton lines={3} />
            <Skeleton lines={1} />
          </Stack>
        </Card>
      </Stack>
    </ControlPlaneShell>
  )
}
