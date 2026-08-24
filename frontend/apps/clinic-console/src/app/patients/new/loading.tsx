import type { ReactElement } from 'react'
import { Card, Grid, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * Registering a patient, in the shape it will arrive in.
 *
 * WHY A SCREEN THAT FETCHES NOTHING STILL EARNS A FALLBACK. `RegisterScreen` is synchronous
 * and the page awaits only its search parameters, so nothing here waits on the API. What the
 * receptionist waits on is the NAVIGATION: clicking through from the registry costs a round
 * trip for this route's payload before anything can change, and until this file existed the
 * fallback Next reached for was `patients/loading.tsx` — the registry's own, which reserves a
 * filter bar and a table. A blank form resolving out of a table outline is a skeleton that
 * promised the wrong layout, which is worse than none: the page moves twice instead of once.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here for real and costs
 * nothing, and why `active="patients"` has to be stated.
 *
 * THE HEADING IS REAL. "Register a patient" is what the page passes to the shell, what the
 * screen's own <h1> says and what the route's metadata title is — one fixed sentence in three
 * places, so rendering a grey bar in its place would be pretending not to know it, and would
 * leave the fallback with no heading for a screen reader to land on. The lede under it is
 * not reserved, for the mechanical reason patients/loading.tsx sets out.
 *
 * THE STANDING NOTICE IS RESERVED BUT NOT TINTED. "What happens when you save this" is on
 * this screen every time, so its height is reserved every time — but a tinted band is how
 * this console says something has gone wrong, and two of the three notices that can appear
 * in that position are failures. Colour in a placeholder is a claim; the block is plain.
 *
 * TWO PANELS ACROSS, AND A THIRD RESERVED SHORT. `Grid cols={2}` is what the real form uses
 * for "the patient" and the optional details beside it, and it collapses at the same width.
 * The guardian panel below appears only for somebody under 18, which is not knowable before
 * a date of birth has been typed, so it is reserved as height and not drawn as a panel.
 */
export default function RegisterPatientLoading(): ReactElement {
  return (
    <ConsoleShell title="Register a patient" active="patients">
      <Stack gap="6">
        <PageHeader title="Register a patient" />

        {/* "What happens when you save this" — the note about a record being created
            awaiting consent, which is on the screen every time. */}
        <Skeleton block="sm" />

        <Grid cols={2} gap="5">
          {Array.from({ length: 2 }, (_unused, index) => (
            /* Index as key: generated from a count, never reordered, no state to carry. */
            <Card key={index} as="section">
              <Stack gap="4">
                <Skeleton lines={1} className="title-sm" />
                <Skeleton lines={1} />
                <Skeleton block="md" />
              </Stack>
            </Card>
          ))}
        </Grid>

        {/* The guardian panel, where the age asks for one, and the save button below it. */}
        <Skeleton block="sm" />
      </Stack>
    </ConsoleShell>
  )
}
