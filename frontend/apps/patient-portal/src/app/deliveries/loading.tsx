import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * The delivery list, held in place while it is read.
 *
 * See services/loading.tsx for why there is no SiteShell and why `.site-root` is still
 * wrapped around this — the header height it hands back is what stops the swap jolting.
 *
 * BOTH WORDS IN THE HEADER ARE REAL. "Delivery" and "What is on its way to you" take no
 * arguments in the catalogue, so they are rendered rather than greyed, and this fallback
 * carries a true `<h1>`. The lede is not rendered, because it interpolates the clinic's
 * name and a `loading.tsx` is given no props with which to resolve a tenant.
 *
 * WHAT THE CARDS DELIBERATELY DO NOT SKETCH. A row on the real screen carries a milestone
 * word, a reference and a time. The placeholder below is undifferentiated bars and a block:
 * it reserves the height and draws no shape that could be read as a status before a status
 * is known. A skeleton that outlined a badge on this screen is a page implying a package
 * has a state while the request that would say so is still open — and "Could not be
 * delivered" is one of the states it might turn out to be.
 *
 * IT IS NOT A CENTRED SPINNER, AND THAT IS THE WHOLE REASON THE FILE EXISTS. A spinner
 * takes no space, so the page jumps when the list lands and the row a patient was reaching
 * for moves out from under their thumb. Skeleton.tsx makes the argument; the obligation it
 * carries is that the placeholder be the shape of the thing, which is why the card count,
 * the card padding and the pager row below all match the real screen.
 *
 * THREE CARDS, NOT FOUR. A patient has fewer deliveries than orders — most orders are
 * collected — so the run here matches `DeliveryList`'s typical page rather than the
 * order list's, and the page settles by filling downward instead of collapsing upward.
 */
export default async function DeliveriesLoading(): Promise<ReactElement> {
  const t = await getTranslations('Delivery')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          <PageHeader eyebrow={t('trackingEyebrow')} title={t('listTitle')} />

          <Stack gap="6">
            <Stack gap="4">
              {Array.from({ length: 3 }, (_unused, index) => (
                /* `padding="tight"` matches DeliveryList's own cards, so the run of boxes
                   is the height the run of boxes will be. */
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
