import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * The catalogue, in the shape it will arrive in.
 *
 * WHY THERE IS NO SiteShell HERE, AND WHY THAT IS NOT AN OVERSIGHT. The clinic's frame is
 * rendered by the PAGE, not by the layout — SiteShell says why — and it needs a resolved
 * Tenant, which is an HTTP call. A `loading.tsx` is a Suspense fallback: it has to be ready
 * before the thing it stands in for, so awaiting a network round trip inside it would
 * delay the very screen whose job is to appear instantly. The frame therefore arrives with
 * the page.
 *
 * `.site-root` IS STILL HERE, WITH NOTHING IN IT BUT THE MAIN ELEMENT, AND IT IS DOING
 * WORK. `.site-root main` sets `padding-top: var(--hh)` — the space the fixed header will
 * occupy. Without that wrapper this fallback would paint its first card at the very top of
 * the viewport and then shove the whole page down by the header's height the moment the
 * real screen replaced it. The wrapper hands back exactly the room the header is about to
 * take, so the swap is a fill rather than a jolt. It also paints `--canvas`, so the
 * fallback is not a white rectangle in a dark-theme browser.
 *
 * THE HEADING IS REAL, NOT GREY. "Book a consultation" and "What do you need?" are fixed
 * strings in this locale's catalogue — they do not depend on the tenant or on anything
 * that has to be fetched — so rendering a grey bar in their place would be pretending not
 * to know something we know. It also means the fallback has a true <h1>: a screen reader
 * landing here is told which page it is on rather than meeting an unlabelled document.
 *
 * The LEDE below the heading is the one thing not reserved, and the reason is mechanical:
 * `PageHeader` renders its description inside a `<p>`, a `<div>` inside a `<p>` is
 * re-parented by the HTML parser, and the resulting hydration mismatch is a worse defect
 * than one paragraph of movement. Every lede on this surface names the clinic, which this
 * component cannot know, so there was no honest text to put there either.
 */
export default async function ServicesLoading(): Promise<ReactElement> {
  const t = await getTranslations('Scheduling')

  return (
    <div className="site-root">
      <main>
        {/* The same wrapper and the same block padding as ServiceCatalogue's own root, so
            the column width and the top of the first card land where they will land. */}
        <PageBody>
          <PageHeader eyebrow={t('catalogue.eyebrow')} title={t('catalogue.title')} />

          {/*
           * A plain Stack rather than the `<ul>` the real catalogue renders. A list of four
           * items that are all `aria-hidden` announces as "list, four items" followed by
           * silence, which is a promise of content that is not there yet. The list
           * semantics arrive with the services.
           *
           * Four, because four is what a small clinic's catalogue looks like. The count is
           * a guess at a length; the CARD is the part that has to be the right shape.
           */}
          <Stack gap="5">
            {Array.from({ length: 4 }, (_unused, index) => (
              <Card key={index}>
                <Stack gap="4">
                  {/* The service name. */}
                  <Skeleton lines={1} />
                  {/* What it is for — two lines is the house length for this field. */}
                  <Skeleton lines={2} />
                  {/* The band holding the modes, the price and "Choose a time". */}
                  <Skeleton block="sm" />
                </Stack>
              </Card>
            ))}
          </Stack>
        </PageBody>
      </main>
    </div>
  )
}
