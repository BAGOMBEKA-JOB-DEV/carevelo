import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, Skeleton, Stack } from '@carevelo/ui'

/**
 * One prescription, held in place while it is read.
 *
 * IT EXISTS SEPARATELY FROM `prescriptions/loading.tsx` BECAUSE THE SHAPES DISAGREE. Next
 * walks up to the nearest fallback, so without this file a patient opening a prescription
 * would watch FOUR list cards resolve into one record. A skeleton that is not the shape of
 * what follows promises a layout and then breaks it, which is worse than no skeleton — and
 * this is a route somebody reaches by tapping a row, so the two shapes would be on screen
 * one after the other every single time.
 *
 * See services/loading.tsx for why there is no SiteShell here and why `.site-root` still
 * wraps this — the header height it hands back is what stops the swap jolting.
 *
 * ------------------------------------------------------------------------------------
 * THE EYEBROW IS REAL AND THE HEADING IS NOT.
 *
 * "Prescription" takes no arguments in either catalogue, so it is rendered rather than
 * greyed, and it carries the page's identity while the rest is unknown. The <h1> below it
 * is the PRESCRIBING CLINICIAN'S NAME, which arrives with the record — `loading.tsx` is
 * passed no props, not even the route parameter, so this file cannot know it and must not
 * put a plausible bar where a clinician's name goes.
 *
 * NOTHING BELOW SKETCHES A MEDICINE. The real screen lists each item with its form,
 * strength, quantity and directions, and a placeholder that outlined those rows would be a
 * shape a patient could start reading a dose off before any of it is true. Three
 * undifferentiated blocks reserve the height instead. On this surface, being wrong in the
 * direction of "looks like a dose" is not an option.
 *
 * NOR DOES IT SKETCH THE STATUS. A prescription may open with a cancelled or superseded
 * warning above the medicines, and that warning is the most important thing on the page
 * when it applies. Its band is reserved so the medicines do not settle and then get pushed
 * down by it — but nothing tinted or badge-shaped is drawn, because a grey rectangle where
 * a status badge goes is a status to anybody glancing.
 * ------------------------------------------------------------------------------------
 */
export default async function PrescriptionLoading(): Promise<ReactElement> {
  const t = await getTranslations('Prescriptions')

  return (
    <div className="site-root">
      <main>
        {/* The inline `paddingBlock` is the one survivor in this file and it is the same
            one every portal fallback carries: `.site-wrap` is a width container and owns no
            vertical rhythm, the block padding belongs to the page rather than to the
            wrapper, and there is no padding prop on the layout primitives to put it in —
            `Stack`, `Inline` and `Grid` decide the space BETWEEN things, not around them.
            The value is the token, so the scale still owns it. */}
        <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
          <Stack gap="6">
            {/* The way back to the list, rendered for real rather than reserved: this is
                the one control a patient can use while the record is still loading, and on
                a connection slow enough for this fallback to be visible it is the one they
                may want. A plain anchor and not `next/link` — a fallback that prefetched
                the list would spend a patient's own data on a page they are leaving. */}
            <a className="lnk" href="/prescriptions">
              {'←'} {t('backToList')}
            </a>

            <Stack gap="4">
              <span className="site-eyebrow">{t('detailEyebrow')}</span>
              {/*
               * Where the clinician's name will be. Skeleton's text bars are `0.72em`, so
               * they take their height from the type size they stand in — body size unless
               * told otherwise, which under a 29px heading reserves about a third of the
               * room the line needs. `.title-lg` is the nearest step on the type scale to
               * `.page-head h1`, so the bar is heading-sized. It is a type class and not a
               * heading: nothing here announces as one.
               */}
              <Skeleton lines={1} className="title-lg" />
              <Skeleton lines={1} />
            </Stack>

            {/* The room a cancelled or superseded warning takes, when there is one. */}
            <Skeleton block="sm" />

            {/* The medicines. Three is a guess at a length; the BLOCK is the part that has
                to be the right shape. */}
            <Stack gap="4">
              {Array.from({ length: 3 }, (_unused, index) => (
                /* Index as key: generated from a count, never reordered, no state. */
                <Card key={index} padding="tight">
                  <Skeleton block="sm" />
                </Card>
              ))}
            </Stack>

            {/* "Issued by" — the clinician, their registration line and the attestation. */}
            <Card padding="tight">
              <Stack gap="3">
                <Skeleton lines={1} />
                <Skeleton lines={2} />
              </Stack>
            </Card>

            {/* The standing note about why a prescription cannot be edited, and the link to
                the signed document. Both are on this page every time. */}
            <Skeleton block="sm" />
          </Stack>
        </div>
      </main>
    </div>
  )
}
