import type { ReactElement } from 'react'
import { Card, Grid, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'

/**
 * The break-glass register, in the shape it will arrive in.
 *
 * THIS IS THE SLOWEST ROUTE IN THE APP AND THE ONE WHERE A FALLBACK MATTERS MOST. The page
 * resolves the operator, then reads the whole tenant register AND the platform health
 * endpoint together, and only then renders. Three round trips before anything can change on
 * screen. Until this file existed, an operator who clicked "Break-glass" went on looking at
 * the page they were already on for the whole of that — and this is a screen people open
 * during an incident, when the instinct on an unresponsive click is to click again.
 *
 * See app/loading.tsx for why the frame is rendered for real and costs nothing.
 *
 * THE HEADING IS REAL. "Break-glass" is what `sections.ts` calls the section and what the
 * topbar shows; the page's own <h1> is fixed too. The lede under it is not reserved — see
 * tenants/loading.tsx for the `<p>`-inside-`<p>` reason, which is mechanical rather than
 * editorial.
 *
 * ------------------------------------------------------------------------------------
 * NOTHING HERE SKETCHES A GRANT, A CLINIC OR A REASON.
 *
 * Every open grant on this screen names a clinic, an operator and a stated reason for
 * reaching into that clinic's data, and every one of them is already written to the audit
 * log and told to the clinic. A placeholder that outlined "clinic / operator / expires" is
 * a shape somebody can start reading before any of it is true, on the one screen in the
 * product where reading the wrong row and acting on it is a live incident. The blocks below
 * reserve height and draw nothing that resembles a record.
 *
 * The FIGURE at the top gets the same treatment for the same reason `app/loading.tsx` gives:
 * "grants live now" is a 28px display number that this fallback has no basis for, and a
 * grey rectangle in that position is a count until it is not.
 * ------------------------------------------------------------------------------------
 */
export default function BreakGlassLoading(): ReactElement {
  return (
    <ControlPlaneShell title="Break-glass" active="break-glass">
      <PageHeader title="Break-glass" />

      <Stack gap="6">
        {/* The "Platform overview" link that opens every screen in this section. */}
        <Skeleton lines={1} />

        {/* The headline card: the live-grant figure beside the paragraph that says what it
            means. `Grid cols={2}` and `gap="6"` are what the screen uses, so the pair
            collapses to one column at the same width the real one does. */}
        <Card as="section">
          <Grid cols={2} gap="6">
            <Skeleton block="sm" />
            <Skeleton lines={4} />
          </Grid>
        </Card>

        {/* The standing warning that everything here is recorded and the clinic is told. It
            is on the screen unconditionally, so its height is reserved unconditionally. */}
        <Skeleton block="sm" />

        {/* "Open right now" — the heading, then whatever is live. Two cards is a guess at a
            length and not a claim about one; on a good day the real answer is none. */}
        <Stack gap="5">
          <Skeleton lines={1} className="title-sm" />
          <Stack gap="4">
            {Array.from({ length: 2 }, (_unused, index) => (
              /* Index as key: generated from a count, never reordered, no state. */
              <Card key={index}>
                <Skeleton lines={2} />
              </Card>
            ))}
          </Stack>
        </Stack>

        {/* "Request a grant" — the form: the clinic, the scope, the reason and the expiry,
            then the notice spelling out what pressing the button does. The tallest block on
            the page and the one the page is opened for. */}
        <Card as="section">
          <Stack gap="7">
            <Skeleton lines={2} />
            <Skeleton block="lg" />
            <Skeleton block="sm" />
          </Stack>
        </Card>

        {/* "The register" — the history, kept permanently, with its cursor pager under it. */}
        <Stack gap="5">
          <Skeleton lines={1} className="title-sm" />
          <Skeleton block="md" />
          <Skeleton lines={1} />
        </Stack>
      </Stack>
    </ControlPlaneShell>
  )
}
