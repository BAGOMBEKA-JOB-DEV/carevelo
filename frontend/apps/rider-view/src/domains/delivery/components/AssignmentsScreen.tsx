import { Button, EmptyState, Notice, PageHeader, Stack } from '@carevelo/ui'
import { attempt } from '@/domains/identity'
import { listAssignments } from '../api/deliveries'
import { href } from '../model/links'
import type { DeliveryPaths } from '../model/types'
import { AssignmentCard } from './AssignmentCard'
import { AssignmentsRefresher } from './AssignmentsRefresher'

/**
 * THE RIDER'S ROUND: the deliveries assigned to them, and nothing else.
 *
 * ------------------------------------------------------------
 * NOTHING HERE FILTERS BY RIDER, AND THAT IS CORRECT
 *
 * `RiderDeliveryController::index()` reads `rider_id` off the SESSION. There is no
 * parameter this screen could send that would widen it, and adding one would suggest,
 * wrongly, that a client-side filter is what keeps one rider's work off another's phone.
 *
 * THERE IS NO DISPATCH BOARD ON THIS SURFACE AND THERE MUST NEVER BE ONE. A rider sees
 * their own assignments; the clinic's board — every delivery, every rider, every address
 * in the district — is a `viewAny` the rider policy refuses. If this screen ever wants a
 * "what else is out there" tab, that is a request to hand the least-trusted actor in the
 * system the whole clinic's day.
 *
 * ------------------------------------------------------------
 * A FAILED READ DOES NOT TAKE THE SCREEN DOWN
 *
 * `attempt()` rather than a throw, and the reason is specific to who is holding the
 * phone. Next's error boundary renders a blank apology with no navigation; a rider who
 * gets one at the roadside cannot tell it from the app being broken, and their next move
 * is a telephone call to the clinic — which is the cost this product exists to remove. A
 * failure leaves the frame, the tab bar and the sign-out in place and says what happened.
 *
 * ------------------------------------------------------------
 * WHY THERE IS NO "FINISHED TODAY" LIST HERE
 *
 * The endpoint returns `assigned`, `picked_up` and `en_route` only, and publishes no
 * query parameters at all. A delivered or failed delivery is gone from every response
 * this app can make. Rendering a "Completed" list from a filter over this one would be a
 * list that is always empty and always wrong, so the confirmation below is what a rider
 * gets instead: the record of what they just did, at the moment they did it.
 */

export type AssignmentsScreenProps = {
  paths: DeliveryPaths
  /** `?cursor=` — from `meta.next_cursor`. Never a page number. */
  cursor?: string | undefined
  /**
   * `?done=delivered` or `?done=failed` — a delivery finished a moment ago and has left
   * this list.
   *
   * THE REFERENCE IS DELIBERATELY NOT CARRIED IN THE URL. It would make a nicer sentence
   * and it would also put a package identifier into browser history, a server access log
   * and any proxy in between, for the sake of one line of copy the rider does not need:
   * they know which delivery they just finished, because they were standing at it.
   */
  done?: string | undefined
  /** `?problem=` — see `StatusProblem`. A status change that could not be completed. */
  problem?: string | undefined
  /** `?message=` — the API's own sentence about that failure. */
  message?: string | undefined
}

export async function AssignmentsScreen({
  paths,
  cursor,
  done,
  problem,
  message,
}: AssignmentsScreenProps) {
  const loaded = await attempt(listAssignments(cursor))

  return (
    <>
      {/* Renders nothing. See the file for why this is the one client component here. */}
      <AssignmentsRefresher />

      <PageHeader title="Assignments" description="The deliveries assigned to you." />

      <Stack gap="5">
        {done === 'delivered' ? (
          <Notice tone="info" icon="check" title="Delivered">
            Recorded. The clinic has been told, and this delivery has left your list.
          </Notice>
        ) : null}

        {done === 'failed' ? (
          /*
           * INFO, NOT AN ERROR TONE. A delivery that could not be completed is a normal
           * outcome the product plans for, and a rider who has just had a door shut in
           * their face should not also be shown a red banner implying they did something
           * wrong. The one thing they must not miss is where the medicine goes now.
           */
          <Notice tone="info" icon="box" title="Recorded as not delivered">
            Take the package back to the pharmacy today. Medicine belongs on licensed
            premises and never stays with a rider overnight — the counter will record that
            it came back.
          </Notice>
        ) : null}

        {problem ? <StatusProblemNotice problem={problem} message={message} /> : null}

        {!loaded.ok ? (
          <Notice tone="bad" title="Your assignments could not be loaded">
            {loaded.message ??
              'The clinic’s system could not be reached. Your deliveries are still '
                + 'assigned to you, and this screen keeps asking every half minute — it '
                + 'will fill in on its own once you have signal.'}
          </Notice>
        ) : loaded.value.data.length === 0 ? (
          <EmptyState title="Nothing to deliver" icon="truck">
            When the clinic assigns you a delivery it will appear here on its own. You do
            not need to refresh.
          </EmptyState>
        ) : (
          <>
            {/*
              A LIST FOR A SCREEN READER'S BENEFIT, NOT A BULLETED ONE. `Stack as="ul"`
              strips the markers and the user-agent indent AND puts `role="list"` back on —
              Safari drops list semantics from an element whose `list-style` is `none`, so
              removing the bullet without restoring the role is how a list stops being
              announced as one. The name matters as much as the role: a rider tabbing into
              this hears "Your deliveries, list, 4 items" and knows how much round is left,
              which is the first thing they want to know and the one thing a run of
              unlabelled cards cannot tell them.
            */}
            <Stack as="ul" gap="5" aria-label="Your deliveries">
              {loaded.value.data.map((delivery) => (
                <AssignmentCard delivery={delivery} key={delivery.id} paths={paths} />
              ))}
            </Stack>

            {/*
              CURSOR, NEVER A PAGE NUMBER. The dispatcher is assigning into the same table
              while a rider pages through it, which is exactly the traffic under which an
              offset duplicates and skips rows — and a skipped row here is a package nobody
              collects. In practice a rider with more than one page of live assignments is
              a rider who has been over-committed, but the link is here rather than
              silently dropping the twenty-sixth.

              A BLOCK BUTTON AND NOT `<Pagination>`, THOUGH THAT COMPONENT NOW EXISTS AND
              PAGES BY CURSOR EXACTLY AS THIS DOES. Pagination renders Previous and Next as
              a pair, and with no `previousHref` — which is this list, because the rider
              endpoint hands back no `prev_cursor` — the Previous half becomes a real
              disabled button. Its own docblock argues against furniture that says "there is
              more here" when there is not, and that argument is sharper on a 390px screen
              held in one hand: a dead control immediately beside the only live one is a
              mis-tap waiting to happen. One full-width target, or nothing.
            */}
            {loaded.value.meta.next_cursor ? (
              <Button
                href={href(paths.assignments, { cursor: loaded.value.meta.next_cursor })}
                variant="quiet"
                block
              >
                Show more
              </Button>
            ) : null}
          </>
        )}
      </Stack>
    </>
  )
}

/**
 * What to say when a status change did not go through.
 *
 * FOUR OUTCOMES, FOUR DIFFERENT NEXT ACTIONS — which is the whole reason the outcome
 * travels as a code rather than as a sentence. "Try again", "go and look", "choose a
 * reason" and "this is not yours any more" are not interchangeable, and a single generic
 * apology would leave the rider guessing which of the four they were in.
 */
function StatusProblemNotice({
  problem,
  message,
}: {
  problem: string
  message?: string | undefined
}) {
  if (problem === 'refused') {
    return (
      <Notice tone="warn" title="That delivery is not yours">
        It has been reassigned, or it was never on your round. Your current assignments are
        below.
      </Notice>
    )
  }

  if (problem === 'conflict') {
    return (
      <Notice tone="warn" title="That delivery has already changed">
        {message ?? 'Somebody else moved it while you were riding. Open it to see where it is now.'}
      </Notice>
    )
  }

  if (problem === 'invalid') {
    return (
      <Notice tone="warn" title="A reason is needed">
        {message ?? 'Choose one of the reasons on the delivery before recording it as not delivered.'}
      </Notice>
    )
  }

  return (
    <Notice tone="bad" title="That did not go through">
      {message ??
        'Nothing was recorded. Open the delivery to check where it is before trying again.'}
    </Notice>
  )
}
