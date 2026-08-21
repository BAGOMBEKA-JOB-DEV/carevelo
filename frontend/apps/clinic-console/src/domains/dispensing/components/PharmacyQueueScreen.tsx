import { Notice } from '@carevelo/ui'
import { attempt } from '../api/http'
import { listLane } from '../api/queue'
import { LANES, LANE_IDS } from '../model/status'
import { abilitiesOf } from '../model/order'
import type { DispensingPaths, Viewer } from '../model/types'
import { LiveQueue } from './LiveQueue'
import { QueueLane } from './QueueLane'

/**
 * The pharmacy queue — the clinic's own licensed pharmacy, working.
 *
 * ------------------------------------------------------------
 * THE BOUNDARY, RESTATED WHERE IT IS ACTED ON. Medicines are held, priced, dispensed and
 * handed over by the clinic's own NDA-licensed pharmacy, by its own licensed staff, under
 * the NDPA Act Cap 206. Carevelo routes a work item and tracks a status: it holds no
 * inventory, touches no medicine and takes no margin on one. This screen is a worklist,
 * not a dispensary, and every price on it was typed by the pharmacy that will hand the
 * medicine over.
 *
 * ------------------------------------------------------------
 * FIVE LANES, FIVE REQUESTS, IN PARALLEL.
 *
 * One per actionable status — see model/status.ts for why lanes rather than one list with
 * a pager, and api/queue.ts for the offset-pagination gap that makes it necessary. Each is
 * wrapped in `attempt()` on its own, so a lane that fails renders its failure and the
 * other four still work. That is not politeness: "Reverb being unavailable degrades to
 * polling and never blocks a dispensing action" is an acceptance criterion, and a bench
 * that goes blank because one query timed out fails the same test one level up.
 *
 * `Promise.all` rather than five awaits in sequence, because five sequential round trips
 * to the API is five times the latency on the screen a pharmacy has open all day.
 */
export async function PharmacyQueueScreen({
  viewer,
  paths,
}: {
  viewer: Viewer | null
  paths: DispensingPaths
}) {
  const abilities = abilitiesOf(viewer)

  /*
   * NOT AN AUTHORISATION DECISION. `DispenseOrderPolicy::viewAny` runs on the API and
   * refuses anyone who is not an administrator or a pharmacist, whatever this screen
   * concludes. What this does is explain the empty screen a clinician or a dispatcher
   * would otherwise get — five lanes of "did not load" with no reason given is how staff
   * learn to distrust the console.
   */
  if (viewer && !abilities.worksTheBench) {
    return (
      <Notice tone="info" title="The queue is the pharmacy's">
        The dispensing queue is open to the clinic administrator and the pharmacists. Your
        account holds neither role here. A clinician reaching a specific order — to decide a
        substitution, for instance — can still open it from the link in the notification
        they were sent.
      </Notice>
    )
  }

  const lanes = await Promise.all(
    LANE_IDS.map(async (id) => ({ id, lane: await attempt(listLane(LANES[id].status)) })),
  )

  return (
    <div className="grid">
      <LiveQueue
        label={
          'This queue refreshes itself every fifteen seconds. It does not wait on a socket, '
          + 'so nothing here is blocked when realtime is unavailable — it simply refreshes '
          + 'less promptly.'
        }
      />

      {/*
       * The rule that most often gets worked around, stated where the work happens. A
       * pharmacist who does not know that the rest of the order still prices will hold the
       * whole thing back for one missing box, and then start pricing on paper.
       */}
      <Notice tone="info" title="A pending substitution blocks only its own item">
        The rest of the order prices and dispenses normally. Only a clinician can approve a
        substitute — not the pharmacist who proposed it, and not the administrator — and
        dispensing is refused while any proposal on the order is still undecided.
      </Notice>

      {lanes.map(({ id, lane }) => (
        <QueueLane key={id} definition={LANES[id]} lane={lane} paths={paths} />
      ))}
    </div>
  )
}
