import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * Where the medicines are, held in place while the delivery is read.
 *
 * See services/loading.tsx for why there is no `SiteShell` and why `.site-root` still wraps
 * this.
 *
 * WHY THIS ROUTE EARNS ONE PARTICULARLY. It is opened from an SMS, on a phone, by somebody
 * who is standing up waiting for a package — and it is read repeatedly, because a person
 * expecting medicines checks again. The page resolves the tenant and the session together
 * and only then reads the tracking record, so every one of those checks costs two round
 * trips in series. Without a fallback the screen a patient sees while it happens is the
 * screen they were already on, which on the second and third check is indistinguishable
 * from nothing having changed.
 *
 * BOTH WORDS IN THE HEADER ARE REAL. "Delivery" and "Where your medicines are" take no
 * arguments in either catalogue, so they are rendered rather than greyed and this fallback
 * carries a true <h1>. What is NOT rendered is the reference under them — "Delivery {ref}" —
 * which arrives with the record.
 *
 * ------------------------------------------------------------------------------------
 * THE STATUS IS RESERVED AND IS NEVER DRAWN AS A BADGE.
 *
 * The one thing this page exists to answer is which of six states a package is in, and the
 * answer is a tinted badge at the top right. A tinted rectangle in that position is a
 * shape somebody standing at a gate can start reading as an answer before there is one —
 * and the tint IS the answer, since a failed delivery is red and a delivered one is not.
 * So nothing here is tinted, nothing is badge-shaped, and the row is reserved as plain
 * height.
 *
 * The same rule governs the milestone list below it. `Stack as="ol"` would announce "list,
 * four items" to a screen reader over four steps that have not happened, which is a claim
 * about how far a package has got. The list semantics arrive with the milestones.
 * ------------------------------------------------------------------------------------
 *
 * NOTHING CLINICAL IS RESERVED BECAUSE THERE IS NONE TO RESERVE. A delivery on this surface
 * carries a reference, an address and a set of timestamps; what is inside the package is not
 * on the endpoint at all. The standing notice at the foot of the real screen says so, and
 * its height is reserved because it is there every time.
 */
export default async function DeliveryTrackingLoading(): Promise<ReactElement> {
  const t = await getTranslations('Delivery')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          <Stack gap="7">
            <Stack gap="4">
              <span className="site-eyebrow">{t('trackingEyebrow')}</span>
              <h1>{t('trackingTitle')}</h1>
              {/* The reference, and the status beside it. Height only — see the docblock. */}
              <Skeleton lines={1} />
            </Stack>

            <Stack gap="4">
              {/* "What has happened so far" — a fixed heading, but held back with the list
                  it heads: a heading over an empty region tells a reader the steps are
                  about to be listed and then leaves them looking at nothing. */}
              <Skeleton lines={1} className="title-sm" />

              {/* The milestones. Four is what a completed delivery looks like; the count is
                  a guess at a length and not a claim about one. */}
              <Skeleton block="md" />
            </Stack>

            {/* The disclosure about what a rider is and is not told. On the screen every
                time, so reserved every time. */}
            <Card as="section" padding="tight">
              <Skeleton lines={2} />
            </Card>
          </Stack>
        </PageBody>
      </main>
    </div>
  )
}
