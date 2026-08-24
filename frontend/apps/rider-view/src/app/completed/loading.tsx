import type { ReactElement } from 'react'
import { Card, Inline, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { FieldShell } from '@/components/FieldShell'

/**
 * The finished list, in the shape it will arrive in.
 *
 * WHY THIS ROUTE NEEDS ONE FOR THE SAME REASON /assignments DOES. Opening it costs two
 * sequential round trips before a single pixel can change: `currentSession()` asks the API
 * who is signed in, and only then does `CompletedScreen` ask for the deliveries. Both are
 * made from a phone on the mobile network that is the reason this product exists. Without
 * this file all of that happens with the PREVIOUS screen still on the display — a rider who
 * taps "Completed" goes on looking at their round, for seconds, which is indistinguishable
 * from a tap that did not register. The honest response to a tap that did not register is
 * another tap, and then another.
 *
 * THE WHOLE FRAME IS REAL, NOT SKELETONED. `FieldShell` is a synchronous server component:
 * it takes one prop and fetches nothing, so this fallback renders the topbar and the tab bar
 * at full fidelity for nothing. Without it the app's own navigation would blank out and
 * come back on every navigation, which is a worse flicker than the one this fixes.
 *
 * `active="completed"` for the same reason the page passes it: a layout is never told which
 * route is rendering inside it, and this fallback IS the completed route. The highlighted
 * tab must not move during the wait — least of all to the tab the rider just left.
 *
 * THE HEADING AND ITS SENTENCE ARE BOTH REAL. "Completed" and "What you have finished in
 * the last three days." are fixed strings in `CompletedScreen`; they depend on nothing that
 * has to be fetched, so greying them out would be pretending not to know something we know
 * and would leave this fallback with no `<h1>` for a screen reader to land on. It also means
 * the RULE — three days — is on screen from the first frame rather than arriving with the
 * data, which is the one thing on this page a rider might otherwise misread as a fault.
 *
 * THREE CARDS, AND THE COUNT IS A GUESS AT A LENGTH RATHER THAN A CLAIM ABOUT ONE. What has
 * to be right is the CARD: reference and status on one line, the recipient's name, the
 * address block, then a single full-width control — so that when the real list lands it
 * fills these boxes instead of resizing them. Note the difference from the round's fallback,
 * and that it is deliberate: a completed card has ONE button where an assignment has two
 * side by side, because there is no "call the recipient" on finished work.
 *
 * NOTHING HERE IS A `<ul>`, THOUGH THE REAL LIST IS ONE. `Stack as="ul"` would announce
 * "list, three items" over three items that do not exist, which is a claim about how much a
 * rider got through made before anything is known about it. The list semantics arrive with
 * the deliveries.
 */
export default function CompletedLoading(): ReactElement {
  return (
    <FieldShell active="completed">
      <PageHeader title="Completed" description="What you have finished in the last three days." />

      {/* `gap="5"` is the gap `CompletedScreen` puts between its notices and its list, so
          the run of cards starts where the run of cards will start. */}
      <Stack gap="5">
        {Array.from({ length: 3 }, (_unused, index) => (
          /* Index as key: generated from a count, never reordered, no state to carry. */
          <Card key={index}>
            <Stack gap="4">
              {/* The package reference and the outcome badge, on one line as they are on
                  the card — `wrap={false}` because that pair is the one row here that would
                  be wrong to break, and it is short enough that it never needs to. */}
              <Inline gap="3" justify="between" wrap={false}>
                <Skeleton lines={1} className="grow" />
                <Skeleton lines={1} />
              </Inline>

              {/* The recipient's name — an <h2> on the real card, so the bar is set at the
                  size that heading occupies rather than at body size. */}
              <Skeleton lines={1} className="title-sm" />

              {/* The address as prose: street, landmark, district, which wraps to two lines
                  on a phone about as often as it does not. */}
              <Skeleton lines={2} />

              {/* The one full-width control under it. */}
              <Skeleton block="sm" />
            </Stack>
          </Card>
        ))}
      </Stack>

      {/* The sign-out row, which every route in this app renders last. Reserved so the foot
          of the page does not walk downward as the list resolves above it. */}
      <Skeleton lines={1} />
    </FieldShell>
  )
}
