import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, Grid, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * The consultation, held in place while the appointment is read.
 *
 * See services/loading.tsx for why there is no `SiteShell` and why `.site-root` still wraps
 * this.
 *
 * THIS FALLBACK IS ON SCREEN AT A FIXED TIME OF DAY, WHICH NO OTHER ONE IN THIS APP IS. A
 * patient opens this link because a consultation starts in a few minutes. The route resolves
 * the tenant and the session together and then reads the appointment and its entry state, so
 * there are two round trips between the tap and anything appearing — and the person waiting
 * on them is watching a clock. Leaving the previous screen up for that is how somebody
 * decides the link is broken and telephones the clinic instead, at the minute the clinician
 * is sitting waiting for them.
 *
 * ------------------------------------------------------------------------------------
 * THE EYEBROW IS REAL AND THE HEADING IS NOT, AND THE SPLIT IS FORCED BY THE PAGE.
 *
 * `ConsultationScreen` resolves to one of two entirely different screens: the join panel
 * before entry, and the live room after it. "Consultation" is true of both, so it is
 * rendered. "Join your consultation" is true of only one — and a heading that says JOIN over
 * a room somebody is already inside, or that changes after it has been read by a screen
 * reader, is worse than a heading that arrives once. So the line is reserved.
 *
 * The same choice is made on /appointments and for the same reason. It is stated again here
 * because the two screens differ far more than that page's two headings do.
 * ------------------------------------------------------------------------------------
 *
 * THE SHAPE BELOW IS THE JOIN PANEL'S, WHICH IS A DELIBERATE BET AND NOT AN OVERSIGHT.
 * Entering the room is a Server Action from this page, so the room is reached by a form
 * submission and the LINK is almost always the join panel — that is what a patient opens
 * from a message, and it is what they get back if their connection drops and they open it
 * again. Reserving the room instead would be the right shape for the rarer path and the
 * wrong one for the common one.
 *
 * NOTHING CLINICAL AND NOTHING IDENTIFYING IS SKETCHED. The three figures at the top of the
 * real panel are the time, the booking reference and the clinician's name; the card below
 * them is fixed prose about what happens on entry. The figures are reserved as a row of
 * three and drawn as none of them — a name in that position is the fact that says whether
 * the right appointment has opened, and it must not be approximated.
 */
export default async function ConsultationLoading(): Promise<ReactElement> {
  const t = await getTranslations('Consultations')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          <div className="page-head">
            <div className="grow">
              <Stack gap="4" align="start">
                <span className="site-eyebrow">{t('eyebrow')}</span>
                <Skeleton lines={1} className="title-lg" />
              </Stack>
            </div>
          </div>

          <Stack gap="5">
            {/* The tinted band: when it is, the reference, and who it is with.
                `Grid cols={3}` is what `.cellgrid--3` gives the real card and it collapses
                at the same width, so the fallback and the page agree at every viewport. */}
            <Card tone="brand" padding="tight">
              <Grid cols={3} gap="5">
                {Array.from({ length: 3 }, (_unused, index) => (
                  /* Index as key: generated from a count, never reordered, no state. */
                  <Skeleton key={index} lines={2} />
                ))}
              </Grid>
            </Card>

            {/* "What happens when you go in", and the three lines under it. */}
            <Card as="section">
              <Stack gap="4">
                <Skeleton lines={1} className="title-sm" />
                <Skeleton lines={3} />
              </Stack>
            </Card>

            {/* The one control on the screen — going in — and the note under it about
                opening the same link again if the connection drops. Reserved on its own so
                it does not arrive by pushing the page under a thumb already moving. */}
            <Skeleton block="sm" />
          </Stack>
        </PageBody>
      </main>
    </div>
  )
}
