import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The audit log, in the shape it will arrive in.
 *
 * IT EXISTS SEPARATELY FROM `payments/loading.tsx` BECAUSE THE SHAPES ARE NOT THE SAME. The
 * money desk's fallback reserves an "open a payment record" panel and a row of three
 * explanatory cards; this screen is a filter panel and a long table. Without this file a
 * clinic administrator clicking "Audit log" would watch that row of three resolve into a
 * table — a skeleton that promised a layout and then broke it.
 *
 * IT IS ALSO ONE OF THE SLOWEST READS IN THE CONSOLE. The audit index is filtered on up to
 * six parameters and paged by cursor, and it is used by somebody working backwards through a
 * question — "who changed this, and when" — so the filters get changed repeatedly and every
 * change is a fresh round trip.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here for real and costs
 * nothing, and why `active="payments"` has to be stated: the audit log lives under the money
 * desk in `sections.ts`, so the highlighted tab must not move during the wait.
 *
 * `title="Payments"` IN THE SHELL AND "Audit log" AS THE HEADING IS NOT AN INCONSISTENCY —
 * it is the arrangement `payments/loading.tsx` already documents. The SECTION is Payments and
 * the screen inside it is the audit log, and both strings are fixed, so both are rendered
 * rather than greyed and this fallback carries a true <h1>.
 *
 * ------------------------------------------------------------------------------------
 * NOTHING BELOW SKETCHES A TABLE, AND ON THIS SCREEN THAT MATTERS MORE THAN ELSEWHERE.
 *
 * A `<table>` of placeholder rows with invented `<th>`s announces as a table with headings
 * and no data — a promise about structure made before any structure exists — and this
 * console's tables carry real `scope` on every header, which is precisely the thing not to
 * counterfeit. The audit log adds a second reason: every row of it is a record of a named
 * member of staff doing something to a named patient's record, and an outline of "who / what
 * / when" is a shape somebody can start reading as evidence. It is the one table in this
 * product whose whole value is that it cannot be altered, and a placeholder that resembles
 * its contents is the nearest thing to altering it that a front end can do.
 * ------------------------------------------------------------------------------------
 */
export default function AuditLogLoading(): ReactElement {
  return (
    <ConsoleShell title="Payments" active="payments">
      <Stack gap="6">
        {/* The nav across the desk, the reconciliation day, the messages and this. */}
        <Skeleton lines={1} />

        <PageHeader title="Audit log" />

        {/* "Nothing here can be changed or removed" — the standing note this screen carries
            every time. Reserved plain: a tint on this console is how a warning is told apart
            from a note, and asserting one before the answer is known is a claim. */}
        <Skeleton block="sm" />

        {/* "Narrow it down": the action, the actor, the subject and the date range. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="md" />
          </Stack>
        </Card>

        {/* The events themselves, and the cursor pager under them. */}
        <Card as="section">
          <Skeleton block="lg" />
        </Card>

        <Skeleton lines={1} />
      </Stack>
    </ConsoleShell>
  )
}
