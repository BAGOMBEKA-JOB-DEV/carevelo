import type { ReactElement } from 'react'
import { Card, Grid, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * Correcting a patient's details, in the shape it will arrive in.
 *
 * IT EXISTS SEPARATELY FROM `patients/[patient]/loading.tsx` because the record's fallback
 * reserves a two-by-two grid of cards and this screen is a form. See patients/loading.tsx for
 * why `ConsoleShell` is rendered here for real and costs nothing, and why `active="patients"`
 * has to be stated.
 *
 * ------------------------------------------------------------------------------------
 * THE SHELL'S TITLE IS REAL AND THE PAGE'S HEADING IS NOT, WHICH LOOKS INCONSISTENT AND IS
 * NOT.
 *
 * "Correct details" is what the ROUTE passes to the shell and what the route's metadata says,
 * unconditionally — so the topbar carries it and the highlighted tab does not move. But the
 * screen's own <h1> is one of two sentences: "Correct details" when the record can be
 * changed, and "Details cannot be changed" when it cannot — a record that was merged away,
 * or one whose registration ended when consent was declined. `PatientDetailsScreen` decides
 * that from the record, which is the thing still being fetched.
 *
 * A heading that says a form is here and then says it is not is worse than a heading that
 * arrives once, especially for somebody listening: a screen reader announces the fallback's
 * heading, the page resolves, and the second announcement contradicts the first. So the line
 * is reserved. The shell above it carries the page's identity in the meantime.
 * ------------------------------------------------------------------------------------
 *
 * TWO PANELS ACROSS AND A THIRD RESERVED SHORT, matching patients/new/loading.tsx, because
 * the two screens render the same field groups: the patient, the optional details beside
 * them, and a guardian panel that appears only where the age asks for one.
 */
export default function PatientDetailsLoading(): ReactElement {
  return (
    <ConsoleShell title="Correct details" active="patients">
      <Stack gap="6">
        {/* Where the heading and the patient's name under it will be. `.title-lg` is the
            nearest step on the type scale to `.page-head h1`, so the bar is the height of
            the line it stands in for rather than the height of body text. */}
        <Stack gap="4">
          <Skeleton lines={1} className="title-lg" />
          <Skeleton lines={1} />
        </Stack>

        {/* "What this changes, and what it does not" — on the screen every time it is a
            form, so its height is reserved. Not tinted: a tint on this console is how a
            refusal is told apart from a note, and this fallback does not know which it is
            about to be. */}
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

        {/* The guardian panel where the age asks for one, and the save button below it. */}
        <Skeleton block="sm" />
      </Stack>
    </ConsoleShell>
  )
}
