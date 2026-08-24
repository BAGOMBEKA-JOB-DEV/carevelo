import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * Issuing a portal account, in the shape it will arrive in.
 *
 * IT EXISTS SEPARATELY FROM `patients/[patient]/loading.tsx` BECAUSE THE SHAPES ARE NOT THE
 * SAME. Without this file Next would walk up to the record's fallback, and a member of staff
 * clicking "Portal account" would watch a two-by-two grid of record cards resolve into a
 * single panel. A skeleton that is not the shape of what follows promises a layout and then
 * breaks it, which costs more movement than no skeleton at all.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here for real and costs
 * nothing, and why `active="patients"` has to be stated.
 *
 * THE HEADING IS REAL AND THE LINE UNDER IT IS NOT, WHICH IS THE WHOLE CARE ON THIS ROUTE.
 * "Portal account" is a fixed phrase — it is the shell's title, the route's metadata title
 * and the screen's own <h1>. The description beside it is the PATIENT'S NAME, read from the
 * record this page is still fetching, and `loading.tsx` is passed no route parameter with
 * which to know it. Putting a plausible-looking bar where a name goes lets somebody start
 * reading the screen as though the right record had opened, and this is the screen that
 * sends a set of sign-in details to an email address. So the line is left to arrive with the
 * record it belongs to.
 *
 * WHAT IS NOT SKETCHED IS THE REFUSAL. Four of the five things this screen can render are
 * refusals — the record was a duplicate, consent was declined, an account already exists,
 * there is no email address — and each is a tinted notice where the form would be. A
 * placeholder cannot be both a form and a refusal, and drawing the form would be the more
 * confident of the two guesses about a screen whose commonest answer is "not this one". The
 * body is reserved as height and drawn as neither.
 */
export default function IssueAccountLoading(): ReactElement {
  return (
    <ConsoleShell title="Portal account" active="patients">
      <Stack gap="6">
        <PageHeader title="Portal account" />

        {/* Either the "Before you create this" caution and the form under it, or one of the
            four refusals in its place. Height only — see the docblock. */}
        <Card as="section">
          <Stack gap="5">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton lines={3} />
            <Skeleton block="sm" />
          </Stack>
        </Card>
      </Stack>
    </ConsoleShell>
  )
}
