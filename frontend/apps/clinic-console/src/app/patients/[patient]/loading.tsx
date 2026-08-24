import type { ReactElement } from 'react'
import { Card, Grid, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * One patient's record, held in place while it is read.
 *
 * NO HEADING, AND ON THIS ROUTE THAT IS THE WHOLE REASON FOR CARE. The page's <h1> is a
 * patient's name. `loading.tsx` is given no props — not the route parameter, not the search
 * parameters — so this file cannot know it, and it must not put a plausible-looking bar
 * where a name goes and let a member of staff start reading the screen as though the right
 * record had opened. The line is reserved and left empty until the name is true.
 *
 * The shell is real (see patients/loading.tsx for why that costs nothing), so the console
 * does not blink its own navigation out while a record loads — which on this route happens
 * every time somebody clicks a row in the registry.
 */
export default function PatientLoading(): ReactElement {
  return (
    <ConsoleShell title="Patients" active="patients">
      <Stack gap="6">
        {/* Where the patient's name and the identifiers under it will be. `.title-lg` is
            the nearest step on the type scale to `.page-head h1`, so the bar is the height
            of the line it stands in for rather than the height of body text. */}
        <Stack gap="4">
          <Skeleton lines={1} className="title-lg" />
          <Skeleton lines={1} />
        </Stack>

        <Grid cols={2} gap="5">
          {Array.from({ length: 4 }, (_unused, index) => (
            <Card key={index}>
              <Stack gap="4">
                <Skeleton lines={1} />
                <Skeleton block="sm" />
              </Stack>
            </Card>
          ))}
        </Grid>
      </Stack>
    </ConsoleShell>
  )
}
