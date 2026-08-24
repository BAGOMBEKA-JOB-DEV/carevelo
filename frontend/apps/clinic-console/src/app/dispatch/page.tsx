import type { Metadata } from 'next'
import { Notice, PageHeader } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'
import { listLane } from '@/domains/dispensing'
import { attempt, currentStaff, DispatchBoardScreen } from '@/domains/delivery'
import { DISPATCH_PATHS } from './paths'

/**
 * The dispatch board.
 *
 * ------------------------------------------------------------
 * THIS ROUTE COMPOSES TWO DOMAINS, WHICH IS THE ONE THING A ROUTE IS FOR.
 *
 * "What is waiting to go out" is a DISPENSING fact — orders in `dispensed` with no delivery
 * yet — and "what is in flight" is a DELIVERY fact. Neither domain may import the other's
 * internals, and neither should have to know the other exists to do its own job. So this
 * file reads the first from the dispensing domain's public surface, wraps it with the
 * delivery domain's `attempt()` so a failure renders as a notice rather than taking the
 * board down, and hands it over as a prop.
 *
 * `Promise.all`, because the session and the dispensed orders are independent and two
 * sequential round trips is twice the latency on a board a clinic keeps open all day.
 */
export const metadata: Metadata = { title: 'Dispatch' }

export default async function DispatchPage() {
  const [viewer, awaitingDispatch] = await Promise.all([
    currentStaff(),
    /*
     * The dispensing domain's read, not a hand-rolled one. `listLane` sends `status` and
     * `per_page` and never `page` — no offset on a live board, ever — and it is the same
     * function the pharmacy queue uses, so the two screens cannot disagree about what
     * "dispensed" means.
     *
     * NOTE WHAT COMES BACK AND WHAT DOES NOT: this endpoint deliberately does not load the
     * prescription, so there are no medicine names in the payload at all. A dispatcher's
     * screen shows a reference and a total, and it could not show more if it wanted to.
     */
    attempt(listLane('dispensed').then((lane) => lane.orders)),
  ])

  return (
    <ConsoleShell title="Dispatch" active="dispatch">
      <PageHeader
        title="Dispatch"
        description={
          <>
            The delivery board, and the rider each dispensed order is handed to. Riders are
            the clinic&rsquo;s own arrangement — Carevelo dispatches and tracks, and operates
            no fleet.
          </>
        }
      />

      {viewer === null ? (
        <Notice tone="warn" title="You are not signed in">
          {/* This console has no sign-in route yet; see app/pharmacy/page.tsx for why that
              is a sentence rather than a redirect. */}
          The board is behind the clinic&rsquo;s own authentication, and this session has
          ended. Sign in again to see it.
        </Notice>
      ) : viewer.password_change_required ? (
        <Notice tone="warn" title="Change your password first">
          Your account still has the password it was issued with. Until it is changed the API
          refuses everything else, so the board cannot load.
        </Notice>
      ) : (
        <DispatchBoardScreen
          viewer={viewer}
          awaitingDispatch={awaitingDispatch}
          paths={DISPATCH_PATHS}
        />
      )}
    </ConsoleShell>
  )
}
