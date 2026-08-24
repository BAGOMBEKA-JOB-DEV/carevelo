import type { ReactElement } from 'react'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * Creating a delivery, in the shape it will arrive in.
 *
 * IT EXISTS SEPARATELY FROM `dispatch/loading.tsx` BECAUSE THE SHAPES ARE NOT REMOTELY THE
 * SAME. Without this file Next walks up to the board's fallback, which reserves six lanes and
 * a panel above them — and a dispatcher who has clicked "Create a delivery" on one order
 * would watch seven card outlines resolve into a single short form. A skeleton that is not
 * the shape of what follows promises a layout and then breaks it.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here for real and costs
 * nothing, and why `active="dispatch"` has to be stated.
 *
 * THE SHELL SAYS "Dispatch" AND THE PAGE HAS NO HEADING OF ITS OWN, which is the screen's own
 * arrangement rather than something this fallback invented: every branch of `NewDeliveryPage`
 * renders straight into the shell — a notice, or the form — and the section name in the
 * topbar is what identifies the screen. So there is no <h1> to reserve here, and reserving one
 * would put a heading-sized bar above a page that never grows a heading.
 *
 * ------------------------------------------------------------------------------------
 * FOUR OF THE FIVE THINGS THIS ROUTE CAN RENDER ARE REFUSALS.
 *
 * The session has ended; the account still holds its issued password; no order was named;
 * dispatch is not this member of staff's to run; and — only then — the form. Three of those
 * are decided before the order is even read, which means the commonest fast path through this
 * route ends in a notice rather than in a form.
 *
 * A placeholder cannot be both, and drawing the form would be the more confident of the two
 * guesses about a screen whose likeliest answer is "not this one". So the body below reserves
 * height and draws neither, and nothing in it is tinted — a tint on this console is how a
 * refusal is told apart from a note, and asserting one before the answer is known would have
 * a dispatcher reading a colour off a grey box.
 * ------------------------------------------------------------------------------------
 */
export default function NewDeliveryLoading(): ReactElement {
  return (
    <ConsoleShell title="Dispatch" active="dispatch">
      <Stack gap="6">
        {/* Either the delivery form — the order it is for, the address, the rider, the note
            that goes with the package — or one of the four refusals in its place. */}
        <Card as="section">
          <Stack gap="5">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton lines={2} />
            <Skeleton block="md" />
            {/* The control that creates it, reserved on its own row: it is the one button on
                the screen, and a control that arrives by pushing the page around is a
                delivery created by accident. */}
            <Skeleton block="sm" />
          </Stack>
        </Card>
      </Stack>
    </ConsoleShell>
  )
}
