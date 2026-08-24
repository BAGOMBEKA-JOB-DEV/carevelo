import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Skeleton, Stack } from '@carevelo/ui'

/**
 * The privacy notice, held in place while the clinic is resolved.
 *
 * See services/loading.tsx for why there is no `SiteShell` and why `.site-root` still wraps
 * this — the header height it hands back is what stops the swap jolting.
 *
 * WHY A PAGE OF FIXED PROSE WAITS ON ANYTHING AT ALL. Nothing on this route is slow to
 * render; what it waits on is `resolveTenant()` and `currentUser()`, which run in parallel
 * and decide two things — whose notice this is, and whether the header shows a way into the
 * patient's own care. The document itself is then interpolated with the clinic's name in
 * something like thirty places. So the page cannot begin until the tenant has answered, and
 * on the connection this product is built for that is a real wait on a route people reach
 * from a footer link at the bottom of a page they were already reading.
 *
 * THE EYEBROW IS REAL AND NOTHING ELSE IS. "Privacy" takes no arguments in either catalogue.
 * The heading is "How {clinic} handles your information." and every second paragraph names
 * the clinic too — so the eyebrow carries the page's identity while the sentence that would
 * name the wrong clinic is reserved and left empty.
 *
 * THE BODY IS RESERVED AS PARAGRAPHS AND NOT AS SECTIONS. `.site-doc` runs eleven headed
 * sections here. Sketching eleven headings would draw an outline of a legal document that
 * has not been read yet, which invites somebody to count the sections and decide what this
 * notice covers before a word of it is true. Four blocks of prose reserve the height and
 * promise nothing about the structure.
 */
export default async function PrivacyLoading(): Promise<ReactElement> {
  const t = await getTranslations('Privacy')

  return (
    <div className="site-root">
      <main>
        <div className="site-pagehero">
          <Stack gap="4">
            <span className="site-eyebrow">{t('eyebrow')}</span>
            {/* Where "How {clinic} handles your information." will be. `.title-lg` is the
                nearest step on the type scale to `.site-h1`, so the bar is heading-sized;
                it is a type class and not a heading, and nothing here announces as one. */}
            <Skeleton lines={1} className="title-lg" />
            <Skeleton lines={2} />
          </Stack>
        </div>

        <div className="site-doc">
          <Stack gap="7">
            {Array.from({ length: 4 }, (_unused, index) => (
              /* Index as key: generated from a count, never reordered, no state to carry. */
              <Stack gap="4" key={index}>
                <Skeleton lines={1} className="title-sm" />
                <Skeleton lines={4} />
              </Stack>
            ))}
          </Stack>
        </div>
      </main>
    </div>
  )
}
