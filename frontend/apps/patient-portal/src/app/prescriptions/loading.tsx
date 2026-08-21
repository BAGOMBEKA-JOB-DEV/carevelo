import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'

/**
 * The prescription list, held in place while it is read.
 *
 * See services/loading.tsx for why there is no SiteShell and why `.site-root` is still
 * wrapped around this — the header height it hands back is what stops the swap jolting.
 *
 * BOTH WORDS IN THE HEADER ARE REAL. "Prescription" and "Your prescriptions" take no
 * arguments in either catalogue, so they are rendered rather than greyed, and this fallback
 * carries a true <h1>.
 *
 * WHAT THE CARDS DELIBERATELY DO NOT SKETCH. A prescription row on the real screen carries
 * a status, an issue date, the prescribing clinician and a count of medicines. The
 * placeholder below is three undifferentiated bars and a block: it reserves the height, and
 * it does not draw a shape that a reader could start interpreting before any of it is true.
 * A skeleton that outlines "prescribed by" and "3 medicines" is a page inviting somebody to
 * read a medicines count off a grey box, and on this surface that is the wrong direction to
 * be wrong in.
 */
export default async function PrescriptionsLoading(): Promise<ReactElement> {
  const t = await getTranslations('Prescriptions')

  return (
    <div className="site-root">
      <main>
        <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
          <PageHeader eyebrow={t('detailEyebrow')} title={t('listTitle')} />

          <Stack gap="6">
            <Stack gap="4">
              {Array.from({ length: 4 }, (_unused, index) => (
                /* `padding="tight"` matches PrescriptionList's own cards, so the run of
                   boxes is the height the run of boxes will be. */
                <Card key={index} padding="tight">
                  <Stack gap="4">
                    <Skeleton lines={1} />
                    <Skeleton block="sm" />
                  </Stack>
                </Card>
              ))}
            </Stack>

            {/* The cursor pager sits under the list on every page of it, so its row is
                reserved too — otherwise the foot of the page walks upward as the list
                resolves under it. */}
            <Skeleton lines={1} />
          </Stack>
        </div>
      </main>
    </div>
  )
}
