import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * Choosing how to pay, held in place while the amount is read.
 *
 * See services/loading.tsx for why there is no `SiteShell` and why `.site-root` still wraps
 * this.
 *
 * ONE FILE FOR BOTH PAYING ROUTES, ON PURPOSE. `/pay/appointment` and `/pay/order/[order]`
 * render the same component with a different payable, so the shape that follows is
 * identical and a fallback at this segment is the honest one for both. It is also the level
 * `error.tsx` sits at, for the same reason.
 *
 * THIS IS THE LONGEST WAIT A PATIENT MEETS BEFORE SPENDING MONEY. Both routes resolve the
 * tenant and the session, and only then read what is being paid for — the appointment and
 * the service catalogue on one, the dispense order on the other. Two round trips in series,
 * from a link somebody has just been sent, immediately before they are asked for an amount.
 * Without a file here the previous screen stays up for the whole of it, which reads as a tap
 * that did not register, and the honest response to a tap that did not register is another
 * tap — on the one route in this product where a repeated action costs real money.
 *
 * THE EYEBROW AND THE HEADING ARE BOTH REAL. "Payment" and "How would you like to pay?" take
 * no arguments in either catalogue, so this fallback carries a true <h1> and says plainly
 * what the screen about to arrive is for. The line under them is "You are paying {clinic}."
 * and is reserved.
 *
 * ------------------------------------------------------------------------------------
 * THE AMOUNT IS RESERVED AND IS NEVER, EVER SKETCHED AS A FIGURE.
 *
 * `.stat__value` renders the price at display size. A grey rectangle of that size in that
 * position is a shape a patient can begin reading as a number before there is a number, and
 * the number in question is the one they are about to send by mobile money. So the block
 * below reserves the whole stat — label, figure and the line naming what it is for — as one
 * undifferentiated area, and no part of it is drawn at figure size.
 *
 * The submit button says "Pay {amount}" for the same reason it is not drawn as a button with
 * text in it: the control and the price arrive together or not at all.
 * ------------------------------------------------------------------------------------
 *
 * THE THREE METHODS ARE RESERVED AS ONE BLOCK RATHER THAN AS THREE ROWS. Which ways to pay a
 * clinic has switched on is a fact only the tenant holds — a clinic with no mobile-money
 * account offers none of them and gets a notice instead — so a fallback that drew three
 * choices would be asserting a count this file cannot know.
 */
export default async function PayLoading(): Promise<ReactElement> {
  const t = await getTranslations('Payments')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          <Card as="section">
            <Stack gap="5">
              <Stack gap="4">
                <span className="site-eyebrow">{t('choose.eyebrow')}</span>
                <h1>{t('choose.title')}</h1>
                {/* "You are paying {clinic}." */}
                <Skeleton lines={1} />
              </Stack>

              {/* The amount, and what it is for. Height only — see the docblock. */}
              <Skeleton block="sm" />

              {/* The methods, and the full-width button under them. */}
              <Skeleton block="md" />

              {/* The line saying the money goes straight to the clinic's own account. It is
                  on the screen every time, so its height is reserved every time. */}
              <Skeleton lines={2} />
            </Stack>
          </Card>
        </PageBody>
      </main>
    </div>
  )
}
