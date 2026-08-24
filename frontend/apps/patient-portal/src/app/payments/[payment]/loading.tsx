import type { ReactElement } from 'react'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * A payment's state, held in place while it is read.
 *
 * See services/loading.tsx for why there is no SiteShell here and why `.site-root` still
 * wraps this.
 *
 * ------------------------------------------------------------------------------------
 * THIS FALLBACK IS DELIBERATELY THE VAGUEST ONE IN THE PORTAL, AND THAT IS THE CORRECT
 * DESIGN RATHER THAN A SHORTCUT.
 *
 * `PaymentStatusPanel` resolves into one of seven quite different screens — succeeded with a
 * receipt, waiting on a handset, back from an unfinished payment page, not started, failed,
 * reversed, or unresolved — and which one it is is
 * the ONLY thing a patient came here to find out. A skeleton has no way of knowing, and any
 * shape specific enough to be useful would also be specific enough to be read as an answer:
 * a receipt-shaped placeholder says "paid" to somebody glancing at their phone, and a
 * patient who reads "paid" off a grey box walks away from a counter they have not settled.
 *
 * So this reserves a heading line and one card, and draws nothing that resembles a status,
 * an amount or a receipt. The page fills it in a moment later with the real answer. The
 * error boundary beside this file — `payments/[payment]/error.tsx` — makes the identical
 * argument for the case where the read fails outright: a payments screen that has read
 * nothing must say it knows nothing, in as many words.
 *
 * NO HEADING TEXT EITHER. Each of the seven panels writes its own <h1>, in the patient's
 * language, and several of them name the clinic. `loading.tsx` is passed no props and
 * cannot resolve a tenant — see services/loading.tsx for why a fetch inside a fallback
 * defeats the fallback — so there is no honest sentence to put there. The line is reserved
 * and left empty.
 * ------------------------------------------------------------------------------------
 *
 * IT IS ALSO ONE OF THE SLOWER ROUTES HERE, SEQUENTIALLY SO: the page reads the tenant and
 * the session together, then the payment intent, and only once it knows the status does it
 * decide whether to read a receipt as well. Three waits, one after another, on the screen
 * somebody refreshes because they are standing in a pharmacy.
 */
export default function PaymentStatusLoading(): ReactElement {
  return (
    <div className="site-root">
      <main>
        {/* The inline `paddingBlock` is this file's one survivor, and it is the same one
            every portal fallback carries: `.site-wrap` is a width container that owns no
            vertical rhythm, and the layout primitives set the space BETWEEN things rather
            than around them, so there is no prop to put it in. The value is the token, so
            the scale still owns it. */}
        <PageBody>
          <Stack gap="6">
            {/*
             * Where the panel's own heading will be. `.title-lg` is the nearest step on the
             * type scale to `.page-head h1`, so the bar is heading-sized rather than
             * body-sized — Skeleton's text bars are `0.72em` and take their height from
             * whatever type size they stand in. It is a type class, not a heading.
             */}
            <Skeleton lines={1} className="title-lg" />

            {/*
             * One card, sized for the middle of the seven outcomes. `block="lg"` reserves the
             * room the fuller panels need — a receipt, or a waiting screen with its "check
             * again" and "try another way" controls — so that the commoner cases fill the
             * space rather than grow into it. Where a shorter panel arrives the page settles
             * upward, which is the direction that does not move a control out from under a
             * thumb already reaching for it.
             */}
            <Card>
              <Stack gap="4">
                <Skeleton lines={2} />
                <Skeleton block="lg" />
              </Stack>
            </Card>

            {/* The way back into the portal that every one of the seven panels offers. */}
            <Skeleton lines={1} />
          </Stack>
        </PageBody>
      </main>
    </div>
  )
}
