import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * The order list, held in place while it is read.
 *
 * See services/loading.tsx for why there is no SiteShell and why `.site-root` is still
 * wrapped around this — the header height it hands back is what stops the swap jolting.
 *
 * BOTH WORDS IN THE HEADER ARE REAL. "Your medicines" and "Orders from the pharmacy" take
 * no arguments in the catalogue, so they are rendered rather than greyed, and this fallback
 * carries a true `<h1>`. The lede is not rendered, because it interpolates the clinic's
 * name and a `loading.tsx` is given no props with which to resolve a tenant.
 *
 * WHAT THE CARDS DELIBERATELY DO NOT SKETCH. A row on the real screen carries a status
 * badge, a reference, an AMOUNT and a handover line. The placeholder below is a run of
 * undifferentiated bars and a block: it reserves the height, and it draws no shape that a
 * reader could start interpreting before any of it is true. A skeleton that outlined a
 * money-shaped rectangle is a page inviting somebody to read a figure off a grey box while
 * the real total is still in flight, and on the one patient screen that says what is OWED
 * that is the wrong direction to be wrong in.
 *
 * IT IS NOT A CENTRED SPINNER, AND THAT IS THE WHOLE REASON THE FILE EXISTS. A spinner
 * takes no space, so the page jumps when the list lands and whatever the reader was
 * reaching for moves out from under their thumb. Skeleton.tsx makes the argument in full;
 * the obligation it comes with is that the placeholder be the shape of the thing, which is
 * why the card count, the card padding and the pager row below all match the real screen.
 */
export default async function OrdersLoading(): Promise<ReactElement> {
  const t = await getTranslations('Dispensing')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          <PageHeader eyebrow={t('listEyebrow')} title={t('listTitle')} />

          <Stack gap="6">
            <Stack gap="4">
              {Array.from({ length: 4 }, (_unused, index) => (
                /* `padding="tight"` matches OrderList's own cards, so the run of boxes is
                   the height the run of boxes will be. Four, because that is a screenful
                   on a phone and the fifth would push the pager off the fold. */
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
        </PageBody>
      </main>
    </div>
  )
}
