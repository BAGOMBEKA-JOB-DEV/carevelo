import type { ReactElement } from 'react'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * Booking, held in place while the slots are read.
 *
 * See services/loading.tsx for why there is no SiteShell and why `.site-root` still wraps
 * this.
 *
 * NO HEADING, FOR THE SAME REASON AS /appointments AND A SHARPER ONE. `BookingScreen`'s
 * <h1> is "Book {service}" — the name of the service the patient chose — and this file
 * cannot know it: `loading.tsx` receives no props, so `?service=` is not visible here, and
 * resolving the name would mean a fetch inside a fallback whose whole purpose is to be
 * ready before a fetch. It cannot render the eyebrow honestly either, because /book shows
 * one screen when a service has been chosen and a different one when it has not.
 *
 * So the header is reserved rather than guessed. Naming the wrong service above a booking
 * form for a quarter of a second is a worse failure than a grey bar: this is the screen
 * where somebody commits to a time and a price.
 *
 * THIS ROUTE IS ALSO THE SLOWEST IN THE PORTAL, which is why it earns a fallback of its
 * own rather than inheriting a generic one. `BookingScreen` reads the service, the
 * clinicians and the availability before it can render anything, and availability is the
 * query the API is slowest at. On a variable mobile connection this fallback is on screen
 * for seconds, not milliseconds — long enough that its shape is what the patient is
 * actually looking at.
 */
export default function BookLoading(): ReactElement {
  return (
    <div className="site-root">
      <main>
        <PageBody>
          <Stack gap="7">
            {/* Eyebrow and heading together — both unknown, so both reserved. */}
            <Stack gap="4">
              <Skeleton lines={1} />
              <Skeleton lines={1} className="title-lg" />
            </Stack>

            {/* The tinted summary card: what was chosen, its price and its duration. */}
            <Card tone="brand">
              <Stack gap="4">
                <Skeleton lines={1} />
                <Skeleton block="sm" />
              </Stack>
            </Card>

            {/* "Narrow the times" — the clinician and day filters. */}
            <Card>
              <Stack gap="4">
                <Skeleton lines={1} />
                <Skeleton block="sm" />
              </Stack>
            </Card>

            {/*
             * The slot grid. `block="lg"` — 220px — because this is the tallest thing on
             * the screen and the part that arrives last, and if it is under-reserved every
             * confirmation control below it travels up the page at the moment the patient
             * is reaching for one.
             */}
            <Card>
              <Stack gap="4">
                <Skeleton lines={1} />
                <Skeleton block="lg" />
              </Stack>
            </Card>
          </Stack>
        </PageBody>
      </main>
    </div>
  )
}
