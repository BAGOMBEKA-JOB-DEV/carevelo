import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * What the clinic has sent, in the shape it will arrive in.
 *
 * THREE READS IN PARALLEL, AND THE SCREEN RENDERS NOTHING UNTIL THE SLOWEST OF THEM ANSWERS:
 * the send history, the SMS allowance and the template catalogue. That is the same argument
 * `pharmacy/loading.tsx` and `dispatch/loading.tsx` make, and it has the same consequence
 * without a file here — a member of staff clicking "Messages" waits on a page that has not
 * visibly changed, having been shown the money desk's own fallback, which reserves a row of
 * three explanatory cards where three quite different panels are about to be.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here for real and costs
 * nothing, and why `active="payments"` has to be stated: messages live under the money desk
 * in `sections.ts`, so the highlighted tab must not move during the wait.
 *
 * `title="Payments"` IN THE SHELL AND "Messages" AS THE HEADING is the arrangement
 * `payments/loading.tsx` documents: the SECTION is Payments and the screen inside it is
 * Messages. Both strings are fixed, so both are rendered and this fallback carries a true
 * <h1>.
 *
 * NO CLINICAL CONTENT IS RESERVED BECAUSE THERE IS NONE ON THIS SCREEN TO RESERVE. What the
 * clinic sends says that something is ready and nothing more — the screen's own standing
 * notice makes that the point of the page — so there is nothing here that a placeholder could
 * outline and disclose. That notice is on the screen every time, so its height is reserved
 * every time.
 *
 * THE ALLOWANCE IS RESERVED AND IS NEVER DRAWN AS A FIGURE. How many messages a clinic has
 * left is a number at display size, and a grey rectangle at that size in that position is a
 * shape somebody can start reading as a count before there is one — on the one panel of this
 * screen that a clinic administrator opens the page specifically to check.
 */
export default function MessagesLoading(): ReactElement {
  return (
    <ConsoleShell title="Payments" active="payments">
      <Stack gap="6">
        {/* The nav across the desk, the reconciliation day, this and the audit log. */}
        <Skeleton lines={1} />

        <PageHeader title="Messages" />

        {/* "Messages say that something is ready, and nothing more." */}
        <Skeleton block="sm" />

        {/* The SMS allowance. Height only — see the docblock. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="sm" />
          </Stack>
        </Card>

        {/* What was sent, whether it arrived, and the cursor pager under it. Nothing here
            counterfeits a table: see payments/audit/loading.tsx for the whole of that
            argument, which applies to this table for the same reasons. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="lg" />
            <Skeleton lines={1} />
          </Stack>
        </Card>

        {/* Every message the platform is capable of sending — a fixed catalogue, but read
            from the API, so it waits with the rest. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="md" />
          </Stack>
        </Card>
      </Stack>
    </ConsoleShell>
  )
}
