import type { ReactElement } from 'react'
import { Card, Inline, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * A month of confirmations, held in place while it is read.
 *
 * ITS OWN FALLBACK RATHER THAN THE SECTION'S, for the same reason reconciliation has one:
 * the endpoint runs three aggregates over a window that may be a year wide, and the screen
 * is opened by somebody who has just changed the dates — so the wait happens on a
 * deliberate action, repeatedly, and a screen that does not visibly respond to a date
 * change invites a second submission.
 *
 * NOTHING BELOW IS A FIGURE, AND THAT IS THE RULE THIS FILE EXISTS TO KEEP. Every other
 * loading skeleton in this console can afford to be approximate about what arrives into it.
 * This one cannot: a grey block where an amount will be is a shape a clinic owner starts
 * reading before any of it is true, and the one number this product must never approximate
 * is the one on this screen. So the two headline slots are reserved as blocks whose HEIGHT
 * is right and whose content is plainly absent, and no digit, currency code or bar is drawn.
 *
 * THE HEADING IS REAL AND THE CAVEAT IS NOT DRAWN. "What your aggregator confirmed" is a
 * fixed string — it is the tab label's sibling and the page title — so it is rendered
 * rather than greyed. The notice above the figures is NOT sketched, even though it appears
 * on every successful render: it carries the API's own sentence about not being able to see
 * the clinic's bank account, and a grey rectangle standing in for that sentence is a
 * rectangle somebody scrolls past on the way to the number. It arrives with the number or
 * neither arrives.
 *
 * See patients/loading.tsx for why ConsoleShell is here and why a table is one block rather
 * than a counterfeit table with invented headings.
 */
export default function ConfirmedPaymentsLoading(): ReactElement {
  return (
    <ConsoleShell title="Payments" active="payments">
      <Stack gap="6">
        <PageHeader title="What your aggregator confirmed" />

        {/* The tab bar across the top of every screen in this section. */}
        <Skeleton lines={1} />

        {/* The window: two date boxes and the button that applies them. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} />
            <Skeleton block="sm" />
          </Stack>
        </Card>

        {/* The headline card: the window on the left, the count and the amount on the
            right, then the sentence saying what the figure is and the list saying what it
            is not. */}
        <Card as="section">
          <Stack gap="5">
            <Inline gap="7" justify="between" align="start">
              <Skeleton lines={1} className="grow" />
              <Skeleton block="sm" className="grow" />
            </Inline>
            <Skeleton block="sm" />
          </Stack>
        </Card>

        {/* The two breakdowns — how the collections were opened, and what they were for. */}
        <Card as="section">
          <Stack gap="5">
            <Skeleton lines={1} />
            <Skeleton block="lg" />
          </Stack>
        </Card>
      </Stack>
    </ConsoleShell>
  )
}
