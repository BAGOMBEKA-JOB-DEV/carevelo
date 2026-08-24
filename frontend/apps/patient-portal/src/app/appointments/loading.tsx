import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * What a patient has booked, held in place while it is fetched.
 *
 * See services/loading.tsx for why there is no SiteShell and why `.site-root` still wraps
 * this.
 *
 * ------------------------------------------------------------------------------------
 * THIS IS THE ONE PORTAL FALLBACK WITH NO <h1>, AND IT IS A DECISION RATHER THAN A GAP.
 *
 * The real heading is one of two sentences — "What is coming up" or "Appointments you have
 * had" — chosen by `?past=1`. A `loading.tsx` is not given searchParams; Next passes it no
 * props at all. So the choice was between rendering the commoner of the two and correcting
 * it a moment later, or reserving the line.
 *
 * A heading that changes after it has been read is worse than one that arrives once,
 * especially for somebody listening: a screen reader announces the fallback's heading, the
 * page resolves, and the second announcement contradicts the first. The EYEBROW above it
 * does not vary — "Your appointments" is true of both views — so it is rendered for real
 * and carries the page's identity while the sentence under it is still unknown.
 *
 * Every other loading file in this app renders its heading, because every other heading is
 * knowable. This one is not, and it says so rather than guessing.
 * ------------------------------------------------------------------------------------
 */
export default async function AppointmentsLoading(): Promise<ReactElement> {
  const t = await getTranslations('Scheduling')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          {/* `gap="7"` reproduces `.page-head`'s own `margin-bottom`, so the first card
              starts where the first card starts. */}
          <Stack gap="7">
            <Stack gap="4">
              <span className="site-eyebrow">{t('appointments.eyebrow')}</span>
              {/*
               * Where the heading will be. Skeleton's text bars are `0.72em`, so they take
               * their height from whatever type size they stand in — which is body size
               * unless told otherwise, and a body-height bar under a 29px heading reserves
               * about a third of the room the sentence needs. `.title-lg` is the nearest
               * step on the type scale to `.page-head h1`, so the bar is heading-sized.
               * It is a type class, not a heading: nothing here announces as one.
               */}
              <Skeleton lines={1} className="title-lg" />
            </Stack>

            {/* The "Coming up" / "Past" pair. Two real buttons' worth of height, reserved
                so the list below does not slide up under a thumb that is already moving
                towards it. */}
            <Skeleton block="sm" />

            <Stack gap="5">
              {Array.from({ length: 3 }, (_unused, index) => (
                <Card key={index}>
                  <Stack gap="4">
                    {/* The service and the time. */}
                    <Skeleton lines={2} />
                    {/* The status badge, the reference and whatever action the state
                        allows — cancel, join, pay. */}
                    <Skeleton block="sm" />
                  </Stack>
                </Card>
              ))}
            </Stack>
          </Stack>
        </PageBody>
      </main>
    </div>
  )
}
