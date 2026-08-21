import type { ReactElement } from 'react'
import { Card, Inline, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { FieldShell } from '@/components/FieldShell'

/**
 * The round, in the shape it will arrive in.
 *
 * WHY THIS ROUTE NEEDS ONE MORE THAN ANY OTHER IN THE APP. Opening /assignments costs two
 * sequential round trips before a single pixel can change: `currentSession()` asks the API
 * who is signed in, and only then does `AssignmentsScreen` ask for the deliveries. Both are
 * made from a phone on the same mobile network that is the reason this whole product
 * exists. Until this file, all of that happened with the previous screen still on the
 * display — a rider who tapped "Assignments" saw the delivery they had just finished, for
 * seconds, which is indistinguishable from a tap that did not register. The honest response
 * to a tap that did not register is another tap, and then another.
 *
 * THE WHOLE FRAME IS REAL, NOT SKELETONED. `FieldShell` is a synchronous server component:
 * it takes one prop and fetches nothing, so a `loading.tsx` can render the topbar and the
 * tab bar at full fidelity for nothing. Without it this fallback would blank the app's own
 * navigation out and put it back a moment later, on every navigation, which is a worse
 * flicker than the one it is here to fix.
 *
 * `active="assignments"` for the same reason the page passes it: the shell requires the
 * section because a layout is never told which route is rendering inside it, and this
 * fallback IS the assignments route. The highlighted tab must not move during the wait.
 *
 * THE HEADING AND ITS SENTENCE ARE BOTH REAL. "Assignments" and "The deliveries assigned to
 * you." are fixed strings in `AssignmentsScreen` — they depend on nothing that has to be
 * fetched — so rendering grey bars in their place would be pretending not to know something
 * we know, and would leave this fallback with no <h1> for a screen reader to land on.
 *
 * THREE CARDS, AND THE COUNT IS A GUESS AT A LENGTH RATHER THAN A CLAIM ABOUT ONE. Three is
 * what a morning round looks like. What has to be right is the CARD: reference and status
 * on one line, the recipient's name, the address block, then the call and open controls —
 * so that when the real list lands it fills these boxes instead of resizing them.
 *
 * NOTHING HERE IS A `<ul>`, THOUGH THE REAL LIST IS ONE. `Stack as="ul"` would announce
 * "list, three items" to a screen reader over three items that do not exist, which is a
 * promise about a rider's workload made before anything is known about it. The list
 * semantics arrive with the deliveries.
 */
export default function AssignmentsLoading(): ReactElement {
  return (
    <FieldShell active="assignments">
      <PageHeader title="Assignments" description="The deliveries assigned to you." />

      {/* `gap="5"` is the gap `AssignmentsScreen` puts between its notices and its list, so
          the run of cards starts where the run of cards will start. */}
      <Stack gap="5">
        {Array.from({ length: 3 }, (_unused, index) => (
          /* Index as key: generated from a count, never reordered, no state to carry. */
          <Card key={index}>
            <Stack gap="4">
              {/* The package reference and the status badge, on one line as they are on the
                  card — `wrap={false}` because that pair is the one row here that would be
                  wrong to break, and it is short enough that it never needs to. */}
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

              {/* The two full-width controls under it: call the recipient, open the
                  delivery. Reserved as one block because they sit on one row. */}
              <Skeleton block="sm" />
            </Stack>
          </Card>
        ))}
      </Stack>

      {/* The sign-out row, which every route in this app renders last. Reserved so the foot
          of the page does not walk downward as the round resolves above it. */}
      <Skeleton lines={1} />
    </FieldShell>
  )
}
