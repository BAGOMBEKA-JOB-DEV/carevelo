import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * Collect it or have it brought, held in place while the order is read.
 *
 * See services/loading.tsx for why there is no `SiteShell` and why `.site-root` still wraps
 * this.
 *
 * IT IS THE SAME TWO-ROUND-TRIP WAIT AS THE TRACKING PAGE and it is reached the same way —
 * from a message the clinic sends when an order is ready. The difference is that this screen
 * ends in a decision rather than a fact, so the cost of leaving the previous page up is a
 * patient who taps the link twice and meets the form twice.
 *
 * BOTH WORDS IN THE HEADER ARE REAL. "Your medicines" and "Collecting, or shall we bring
 * it?" take no arguments in either catalogue. The sentence under them names the clinic and
 * is reserved, as is the order reference in the badge beside them.
 *
 * ------------------------------------------------------------------------------------
 * THE MONEY IS RESERVED AS A PANEL AND NOT AS A TABLE OF FIGURES.
 *
 * The real card sets out three rows — medicines, delivery, total — with an amount at the end
 * of each. Drawing three rows with a short bar on the right is the shape of a priced order,
 * and a patient can read a shape: they will see that there are three lines and that one of
 * them is a delivery charge, before it is known whether delivery is even offered on this
 * order. A controlled medicine cannot be delivered at all, and that refusal changes the
 * card. So the panel reserves its height and draws nothing that resembles a figure.
 *
 * THE CHOICE BELOW IT IS RESERVED THE SAME WAY, and for a sharper reason: whether "bring it
 * to me" is on the screen depends on the contents of the order and on where the patient
 * lives. A fallback that drew two options would promise a choice this file has no way of
 * knowing exists, to somebody who may be about to be told that this one has to be collected
 * in person.
 * ------------------------------------------------------------------------------------
 */
export default async function FulfilmentLoading(): Promise<ReactElement> {
  const t = await getTranslations('Delivery')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          <Stack gap="7">
            <Stack gap="4">
              <span className="site-eyebrow">{t('fulfilmentEyebrow')}</span>
              <h1>{t('fulfilmentTitle')}</h1>
              {/* The clinic's sentence, and the order reference beside it. */}
              <Skeleton lines={1} />
            </Stack>

            {/* What it costs. `padding="tight"` matches the real card, so the panel is the
                height the panel will be. */}
            <Card as="section" padding="tight">
              <Stack gap="3">
                <Skeleton lines={1} className="title-sm" />
                <Skeleton block="sm" />
                {/* The line saying the clinic sets these prices and receives the payment. */}
                <Skeleton lines={1} />
              </Stack>
            </Card>

            {/* The choice and the button that ends it. Height only — see the docblock. */}
            <Skeleton block="md" />
          </Stack>
        </PageBody>
      </main>
    </div>
  )
}
