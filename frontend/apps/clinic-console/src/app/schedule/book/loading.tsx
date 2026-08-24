import type { ReactElement } from 'react'
import { Card, Grid, Inline, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * Booking for a caller, in the shape it will arrive in.
 *
 * THIS IS THE ONE SCREEN IN THE CONSOLE WITH SOMEBODY ON THE TELEPHONE AT THE OTHER END OF
 * IT, and that is the whole argument for the file. `AssistedBooking` reads the session, then
 * the patient record, then the services, then the availability for a day — and availability
 * is the query the API is slowest at. Every one of those waits happens while a receptionist
 * is holding a handset and a caller is listening to silence. Until this file existed the
 * fallback was `schedule/loading.tsx`, the day view's own, which reserves a run of
 * appointment cards where a booking form is about to be.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here for real and costs
 * nothing, and why `active="schedule"` has to be stated.
 *
 * THE HEADING IS REAL. "Book for a caller" is what the route passes to the shell, what the
 * route's metadata says and what the screen's own <h1> says. The lede under it is not
 * reserved, for the mechanical reason patients/loading.tsx sets out.
 *
 * THE "BOOKING FOR" ROW IS RESERVED AND THE NAME IN IT IS NOT DRAWN. That row carries the
 * patient's name, their telephone number and, where the record is not active, a badge saying
 * so. All three arrive with the record; a plausible-looking bar where a name goes would let a
 * receptionist start reading the screen as though the right caller's record had opened, which
 * on a telephone — where the name is what is being read back to confirm it — is the wrong
 * direction to be wrong in. The badge is not sketched either: whether it is there at all is
 * information, and a grey rectangle in that position asserts a status exists.
 *
 * THE SLOT GRID IS `Grid cols={4}`, WHICH IS WHAT THE REAL PICKER USES, and eight is a guess
 * at a morning's free times rather than a claim about one. What has to be right is the grid,
 * so that the times fill these boxes instead of resizing them under a cursor that is already
 * moving towards one. Nothing inside them is drawn at figure size: a bar where a clock time
 * goes is a time somebody can start reading before there is one.
 */
export default function AssistedBookingLoading(): ReactElement {
  return (
    <ConsoleShell title="Book for a caller" active="schedule">
      <Stack gap="6">
        <PageHeader title="Book for a caller" />

        <Stack gap="5">
          {/* "Booking for" — the caller's record, and the way to pick somebody else. */}
          <Inline className="card" gap="4" justify="between">
            <Skeleton lines={2} className="grow" />
            <Skeleton lines={1} />
          </Inline>

          {/* The service, the clinician and the day. */}
          <Card as="section">
            <Stack gap="4">
              <Skeleton lines={1} className="title-sm" />
              <Skeleton block="sm" />
            </Stack>
          </Card>

          {/* The free times. */}
          <Card as="section">
            <Stack gap="4">
              <Skeleton lines={1} />
              <Grid cols={4} gap="3">
                {Array.from({ length: 8 }, (_unused, index) => (
                  /* Index as key: generated from a count, never reordered, no state. */
                  <Skeleton key={index} block="sm" />
                ))}
              </Grid>
              {/* The control that takes the booking. */}
              <Skeleton lines={1} />
            </Stack>
          </Card>
        </Stack>
      </Stack>
    </ConsoleShell>
  )
}
