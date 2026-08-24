import type { ReactElement } from 'react'
import { Card, Grid, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The registry, in the shape it will arrive in.
 *
 * THE WHOLE FRAME IS REAL, NOT SKELETONED, AND THAT IS THE POINT OF PUTTING ConsoleShell
 * HERE. `ConsoleShell` is a synchronous server component: it takes a title and a section
 * name and fetches nothing, so a `loading.tsx` can render the sidebar, the topbar and the
 * tab bar at full fidelity for no cost at all. Without it this fallback would replace the
 * whole console with a bare rectangle and then put the navigation back a moment later —
 * every screen in the product blinking its own chrome out on every navigation.
 *
 * `active="patients"` for the same reason the page passes it: the shell requires the
 * section, a layout is never told which route is rendering inside it, and this fallback IS
 * the patients route. The highlighted tab must not move during the wait.
 *
 * THE HEADING IS REAL. "Patients" is a fixed word — it is what `sections.ts` calls this
 * section and what the page's own <h1> says — so rendering a grey bar in its place would be
 * pretending not to know something we know, and would leave the fallback with no heading
 * for a screen reader to land on.
 *
 * THE LEDE UNDER THE HEADING IS NOT RESERVED, and that is a choice with a cost. Two things
 * rule it out: the sentence is domain prose that lives in `RegistryScreen`, so copying it
 * here would make two copies of one sentence that have to be kept saying the same thing;
 * and a placeholder cannot go in its place, because `PageHeader` renders its description
 * inside a `<p>` and the HTML parser re-parents a `<div>` out of a `<p>`, which is a
 * hydration mismatch. So the lede arrives with the page and pushes the filters down by one
 * paragraph. That is stated here rather than hidden, because the alternative — a sentence
 * on screen that silently becomes a different sentence — is the failure this whole file is
 * written to avoid.
 *
 * WHY THE TABLE IS ONE BLOCK AND NOT A SKELETON TABLE. A `<table>` of placeholder rows with
 * invented `<th>`s announces as a table with headings and no data, which is a promise about
 * structure made before any structure exists — and this project's tables are real tables
 * carrying real `scope`, which is precisely the thing not to counterfeit. The block reserves
 * the height; the semantics arrive with the rows.
 */
export default function PatientsLoading(): ReactElement {
  return (
    <ConsoleShell title="Patients" active="patients">
      <Stack gap="6">
        <PageHeader title="Patients" />

        {/* The filter form: the search field, the status select and the buttons under
            them. `Grid cols={2}` is what the real form uses, and it collapses at the same
            width, so the fallback and the page agree at every viewport. */}
        <Card>
          <Stack gap="5">
            <Grid cols={2} gap="5">
              <Skeleton block="sm" />
              <Skeleton block="sm" />
            </Grid>
            <Skeleton lines={1} />
          </Stack>
        </Card>

        {/* The registry table: name, phone, status, portal account, registered. */}
        <Card>
          <Skeleton block="lg" />
        </Card>
      </Stack>
    </ConsoleShell>
  )
}
