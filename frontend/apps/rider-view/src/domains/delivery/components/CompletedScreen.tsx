import { Button, EmptyState, Notice, PageHeader, Stack } from '@carevelo/ui'
import { attempt } from '@/domains/identity'
import { listCompleted } from '../api/deliveries'
import { href } from '../model/links'
import type { DeliveryPaths } from '../model/types'
import { CompletedCard } from './CompletedCard'

/**
 * WHAT THIS RIDER HAS FINISHED RECENTLY — and nothing older, and nobody else's.
 *
 * ==================================================================
 * THIS SCREEN EXISTS BECAUSE THE SERVER MADE IT POSSIBLE, IN THAT ORDER
 * ==================================================================
 *
 * The file that stood here was an honest placeholder, and it said why: `index()` filtered
 * to `assigned`, `picked_up` and `en_route` and published no query parameters at all, so a
 * "Completed" list built against it would have been a list that was always empty on a
 * screen that promised otherwise. Its closing argument was that the fix was a backend
 * change and a DISCLOSURE decision rather than a convenience — how far a rider may read
 * back, and how far is too far — and that the argument belonged in the API. It did, it was
 * made there, and this screen is downstream of it.
 *
 * ==================================================================
 * THE WINDOW IS THE SERVER'S AND THIS SCREEN SAYS SO OUT LOUD
 * ==================================================================
 *
 * `RiderDeliveryController::COMPLETED_WINDOW_HOURS` is 72 hours: a full working day plus
 * the day either side, so a Saturday round is still readable on Monday and a Friday dispute
 * does not fall off the end of a weekend. Short enough that a rider who leaves the clinic's
 * arrangement holds nothing readable within the working week, and short enough that a lost
 * handset is a bounded exposure rather than an open-ended one.
 *
 * The screen TELLS THE RIDER that, in one line, rather than letting a list quietly stop. A
 * rider who scrolls to the end of three days and finds nothing has to decide whether the
 * app is broken, and a rider who decides the app is broken telephones the clinic — the cost
 * this product exists to remove. Saying "the last three days" costs one sentence and
 * removes the whole question.
 *
 * IT IS NOT AN APOLOGY AND MUST NOT BECOME ONE. The line states a rule, not a shortfall.
 * Nothing here should offer to show more, ask the clinic for more, or imply that a longer
 * history exists somewhere a rider could get at it.
 *
 * ==================================================================
 * NOTHING HERE FILTERS BY RIDER, AND THAT IS CORRECT
 * ==================================================================
 *
 * `index()` reads `rider_id` off the SESSION. There is no parameter this screen could send
 * that would widen it, and adding one would suggest — wrongly — that a client-side filter
 * is what keeps one rider's finished work off another's phone. The same is true of the
 * window: it is applied in the query and again on `show`, so this screen could not read
 * past it even by holding an identifier.
 *
 * ==================================================================
 * A FAILED READ DOES NOT TAKE THE SCREEN DOWN
 * ==================================================================
 *
 * `attempt()` rather than a throw, for the reason `AssignmentsScreen` gives: Next's error
 * boundary renders a blank apology with no navigation, and a rider who meets one at the
 * roadside cannot tell it from the app being broken. A failure leaves the frame, the tab
 * bar and the sign-out in place and says what happened. It matters slightly less here than
 * on the round — nobody is waiting on this screen — which is exactly why it would have been
 * tempting to skip, and why it is not skipped.
 *
 * ONE-HANDED, ON A MOTORCYCLE, IN KAMPALA SUNLIGHT. Every target on this screen is
 * full-width: the "Open" on each card and the "Show more" that closes the list. The pager
 * is the lowest control on the page, which is where a thumb rests on a phone held in one
 * hand, and it is the only thing below the last card — so the one control a rider reaches
 * for without looking cannot be mistaken for anything else.
 */

export type CompletedScreenProps = {
  paths: DeliveryPaths
  /** `?cursor=` — from `meta.next_cursor`. Never a page number. */
  cursor?: string | undefined
}

export async function CompletedScreen({ paths, cursor }: CompletedScreenProps) {
  const loaded = await attempt(listCompleted(cursor))

  return (
    <>
      {/*
        NO `AssignmentsRefresher` HERE, AND ITS ABSENCE IS A DECISION. The round polls
        because a dispatcher may assign work while the rider is looking at it. Finished work
        does not change: a delivered delivery stays delivered. A refresh loop on this screen
        would spend a rider's data bundle re-fetching an answer that cannot move, and would
        keep a list of patients' names and addresses arriving at a handset that is sitting
        in a pocket.
      */}
      <PageHeader title="Completed" description="What you have finished in the last three days." />

      <Stack gap="5">
        {!loaded.ok ? (
          <Notice tone="bad" title="Your finished deliveries could not be loaded">
            {loaded.message ??
              'The clinic’s system could not be reached. Nothing you have recorded is '
                + 'lost — this screen only reads. Try again once you have signal.'}
          </Notice>
        ) : loaded.value.data.length === 0 ? (
          /*
           * TWO REASONS FOR AN EMPTY LIST, AND THE COPY COVERS BOTH WITHOUT GUESSING WHICH.
           * A rider who has finished nothing in three days sees the same list as a rider
           * whose last round was four days ago, and this screen cannot tell them apart —
           * the window is applied in the query, so a delivery outside it is not "hidden
           * here", it never arrived. Saying "nothing in the last three days" is true of
           * both and claims nothing about either.
           */
          <EmptyState title="Nothing finished in the last three days" icon="check">
            Deliveries appear here once you have marked them delivered, or recorded that
            they could not be delivered. They stay for three days and then drop off.
          </EmptyState>
        ) : (
          <>
            {/*
              A LIST FOR A SCREEN READER'S BENEFIT, NOT A BULLETED ONE. `Stack as="ul"`
              strips the markers and the user-agent indent AND puts `role="list"` back on —
              Safari drops list semantics from an element whose `list-style` is `none`. The
              name matters as much as the role: a rider tabbing in hears "Recently
              finished, list, 6 items", which is the count they came to check.
            */}
            <Stack as="ul" gap="5" aria-label="Recently finished">
              {loaded.value.data.map((delivery) => (
                <CompletedCard delivery={delivery} key={delivery.id} paths={paths} />
              ))}
            </Stack>

            {/*
              CURSOR, NEVER A PAGE NUMBER, for the same reason the round pages by cursor: a
              rider finishing deliveries while paging through them is exactly the traffic
              under which an offset duplicates and skips rows.

              A BLOCK BUTTON AND NOT `<Pagination>`. That component renders Previous and
              Next as a pair, and this endpoint hands back no `prev_cursor` — so the
              Previous half would be a real disabled button sitting immediately beside the
              only live one, on a 390px screen, under a thumb. One full-width target, or
              nothing.
            */}
            {loaded.value.meta.next_cursor ? (
              <Button
                href={href(paths.completed, { cursor: loaded.value.meta.next_cursor })}
                variant="quiet"
                block
              >
                Show more
              </Button>
            ) : (
              /*
               * THE END OF THE WINDOW, STATED WHERE THE RIDER REACHES IT. Without this the
               * list simply stops, and a list that stops is indistinguishable from a list
               * that failed to load the rest — which is the reading that ends in a
               * telephone call to the dispatcher.
               */
              <p className="muted">
                That is everything from the last three days. Older deliveries are on the
                clinic’s own records.
              </p>
            )}
          </>
        )}
      </Stack>
    </>
  )
}
