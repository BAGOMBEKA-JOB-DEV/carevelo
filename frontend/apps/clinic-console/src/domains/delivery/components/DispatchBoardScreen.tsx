import { Notice } from '@carevelo/ui'
import type { DispenseOrder, Viewer } from '@/domains/dispensing'
import { attempt, type Attempt } from '../api/http'
import { abilitiesOf, listLane } from '../api/deliveries'
import { LANES, LANE_IDS } from '../model/status'
import type { DispatchPaths } from '../model/types'
import { AwaitingDispatch } from './AwaitingDispatch'
import { BoardLane } from './BoardLane'
import { LiveBoard } from './LiveBoard'

/**
 * The dispatch board — what is waiting to go out, what is in flight, what came back.
 *
 * ------------------------------------------------------------
 * CAREVELO DISPATCHES AND TRACKS. IT OPERATES NO FLEET. The rider is the clinic's own
 * arrangement; the platform routes a work item and records a status. Operating a fleet
 * would make us a logistics company handling pharmaceuticals, which is explicitly out of
 * scope, and the shape of this screen follows from that: everything on it is a reference
 * and a state.
 *
 * ------------------------------------------------------------
 * SIX LANES, SIX REQUESTS, IN PARALLEL, EACH FAILING ON ITS OWN.
 *
 * One per status — see model/status.ts for why lanes rather than a pager. `Promise.all`
 * rather than six sequential awaits, because six round trips in series is six times the
 * latency on a screen a clinic keeps open. Each is wrapped in `attempt()` separately, so a
 * lane that fails renders its failure and the rest of the board still works.
 *
 * `delivered` is not a lane. A board is a worklist and a delivered package needs nothing
 * from a dispatcher; it is reached from the order, which is where somebody asking about it
 * starts anyway.
 */
export async function DispatchBoardScreen({
  viewer,
  awaitingDispatch,
  paths,
}: {
  viewer: Viewer | null
  /**
   * Dispensed orders with no delivery yet, fetched by the ROUTE from the dispensing domain.
   * Cross-domain composition belongs in the route layer; see AwaitingDispatch.
   */
  awaitingDispatch: Attempt<readonly DispenseOrder[]>
  paths: DispatchPaths
}) {
  const abilities = abilitiesOf(viewer)

  /*
   * NOT AN AUTHORISATION DECISION. `DeliveryPolicy::viewAny` runs on the API and refuses
   * anyone who is not an administrator, a dispatcher or a pharmacist — riders never see
   * this board, which is the first line of that policy. What this does is explain the empty
   * screen somebody would otherwise get, because six lanes of "did not load" with no reason
   * is how staff learn to distrust a console.
   */
  if (viewer && !abilities.seesTheBoard) {
    return (
      <Notice tone="info" title="The board is dispatch's">
        The dispatch board is open to the clinic administrator, the dispatchers and the
        pharmacists. Your account holds none of those roles here. A rider sees only their own
        assigned deliveries, on their own surface, and never this board.
      </Notice>
    )
  }

  const lanes = await Promise.all(
    LANE_IDS.map(async (id) => ({ id, lane: await attempt(listLane(LANES[id].status)) })),
  )

  return (
    <div className="grid">
      <LiveBoard
        label={
          'This board refreshes itself every fifteen seconds. It does not wait on a socket, '
          + 'so nothing here is blocked when realtime is unavailable — it simply refreshes '
          + 'less promptly.'
        }
      />

      {/*
       * The rule a dispatcher will otherwise meet as an unexplained refusal, stated before
       * they meet it. Both halves matter: the controlled-substance exclusion has no
       * override anywhere in the product, and the consent check runs again at the moment of
       * assignment because that is the instant an address reaches a person.
       */}
      <Notice tone="warn" title="Two things a delivery can be refused for, and neither has an override">
        An order holding a controlled medicine cannot be delivered at all under the NDPA Act
        Cap 206 — it is collected in person, or the deliverable items are dispatched as a
        separate order. And an address never reaches a rider without the patient&rsquo;s
        delivery consent, which is checked again when you assign, not only when the delivery
        was created.
      </Notice>

      <AwaitingDispatch
        orders={awaitingDispatch}
        mayDispatch={abilities.seesTheBoard}
        paths={paths}
      />

      {lanes.map(({ id, lane }) => (
        <BoardLane key={id} definition={LANES[id]} lane={lane} paths={paths} />
      ))}
    </div>
  )
}
