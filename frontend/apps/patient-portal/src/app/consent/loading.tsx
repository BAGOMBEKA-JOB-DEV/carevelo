import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * The consent screen, held in place while the policy is read.
 *
 * See services/loading.tsx for why there is no `SiteShell` and why `.site-root` still wraps
 * this.
 *
 * THIS IS THE SLOWEST STEP OF REGISTERING AND THE ONE PEOPLE ARE MOST LIKELY TO ABANDON.
 * The page resolves the tenant and the registration handoff together, and only THEN reads
 * the current consent policy — deliberately sequential, because there is no point spending a
 * round trip on a handset to fetch a policy for a registration this browser cannot name. So
 * a patient arriving here from the registration form waits on two round trips in series, at
 * the exact moment they have just typed their name and telephone number in and are deciding
 * whether this was a good idea.
 *
 * TWO STRINGS ARE REAL. "Consent" and "Read this, then decide. Nothing here is ticked for
 * you, and nothing is agreed by carrying on." take no arguments, and the second one is worth
 * having on screen during the wait rather than after it: it is the sentence that tells
 * somebody the page they are looking at will not commit them to anything while it loads. The
 * heading is "How {clinic} will use your information" and is reserved.
 *
 * ------------------------------------------------------------------------------------
 * NOT ONE OF THE DECISIONS IS SKETCHED, AND THAT IS THE WHOLE POINT OF THIS FILE.
 *
 * The real screen puts three separate consent decisions in front of a patient, each with its
 * own heading, its own explanation and its own pair of controls. A skeleton that drew three
 * labelled panels with a control-sized bar in each would be an outline of a set of choices —
 * how many there are, roughly how long each one is — presented before a single word of any of
 * them has been read. On a consent screen that is the wrong direction to be wrong in: the
 * shape of a decision is part of the decision.
 *
 * So the policy is reserved as one tall tinted panel, because a tinted panel of prose is what
 * it is, and the decisions below it are reserved as height and nothing else.
 * ------------------------------------------------------------------------------------
 *
 * THE DECLINED VIEW IS NOT RESERVED SEPARATELY. `?declined=1` renders an entirely different
 * screen; `loading.tsx` is passed no search parameters, and a fallback cannot be both.
 */
export default async function ConsentLoading(): Promise<ReactElement> {
  const t = await getTranslations('Patients')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          {/* 30px between the blocks, which is the gap ConsentScreen.tsx states on its own
              `<Stack gap="8">`. Same column, same step: a skeleton whose rhythm differs from
              the screen it reserves space for hands the patient a page that resettles the
              moment it loads. */}
          <Stack gap="8">
            <div className="site-sec-head">
              <Stack gap="4">
                <span className="site-eyebrow">{t('consent.eyebrow')}</span>
                <Skeleton lines={1} className="title-lg" />
                <p className="site-lede">{t('consent.lede')}</p>
              </Stack>
            </div>

            {/* The policy itself, in the tinted panel it is read in. `block="lg"` — 220px —
                because this is the tallest thing on the screen by a distance and the part
                that arrives last, and if it is under-reserved every control below it travels
                up the page at the moment somebody is reaching for one. */}
            <Card as="section" tone="brand">
              <Stack gap="4">
                <Skeleton lines={1} className="title-sm" />
                <Skeleton block="lg" />
              </Stack>
            </Card>

            {/* The decisions. Height only — see the docblock. */}
            <Skeleton block="lg" />

            {/* The row of controls that ends the step. */}
            <Skeleton block="sm" />
          </Stack>
        </PageBody>
      </main>
    </div>
  )
}
