import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FieldShell } from '@/components/FieldShell'
import { CompletedScreen } from '@/domains/delivery'
import { AccessNotice, SignOutButton, currentSession, isRider } from '@/domains/identity'
import { DELIVERY_PATHS, SIGN_IN_PATH } from '@/app/paths'

/**
 * What this rider has finished in the last three days.
 *
 * ==================================================================
 * THIS FILE USED TO SAY THE SCREEN COULD NOT BE BUILT. IT CAN NOW, AND HERE IS WHY.
 * ==================================================================
 *
 * The placeholder that stood here was right on every point and is worth restating rather
 * than deleting, because the thing that changed is a fact about the API and not a change of
 * mind about the design. It said: `GET /v1/rider/deliveries` filtered to `assigned`,
 * `picked_up` and `en_route` in the controller and published no query parameters at all, so
 * a delivered or failed delivery was absent from every response this app could ask for. A
 * "Completed" list built against that would have been a list that is always empty on a
 * screen that promises otherwise — "worse than an honest placeholder by some distance: a
 * rider who has learned to distrust one screen distrusts the assignments screen too, and
 * then telephones the clinic instead."
 *
 * It also said what would make it real, and set the terms: "either a status filter on the
 * rider index, or a second endpoint. Both are backend changes and both are disclosure
 * decisions rather than conveniences: they widen what a rider may read back, and how far,
 * and the arguments for a window and against a permanent history belong in the API, not
 * here." The status filter is the one that landed, the window is 72 hours, and
 * `RiderDeliveryController::COMPLETED_WINDOW_HOURS` carries the argument for that number.
 *
 * AND THE THING IT WARNED AGAINST STILL HOLDS. `GET /v1/deliveries` — the dispatcher's
 * index — would answer some of this and serves `DeliveryResource`, which carries
 * `failure_reason`, the dispense order and the rest of the clinic's record. It is
 * `viewAny`, which the rider policy refuses, and reaching for it would be the exact erosion
 * the rider rule is written against. Nothing in this app knows its name.
 *
 * ==================================================================
 * THE ROUTE ITSELF IS THE ASSIGNMENTS ROUTE WITH ONE SCREEN SWAPPED
 * ==================================================================
 *
 * Thin by design: resolve who is signed in, decide whether they may be here, hand off to
 * the domains. Every guard below is the one /assignments makes, and for the same reasons —
 * they are restated here rather than factored out because a shared guard is a guard that
 * can be forgotten on the next route, and this is the surface where "an empty list" and
 * "you are not allowed" must never look the same.
 *
 * THE SESSION CHECK ASKS THE API RATHER THAN READING THE COOKIE. A cookie is opaque and
 * cannot know it has been invalidated — sessions end on password change, role change,
 * deactivation and tenant suspension — and a rider whose role was revoked this morning must
 * not be shown three days of patients' names and addresses.
 *
 * ONLY A GUEST IS REDIRECTED. A session that could not be READ is a third state and is
 * handled on this page rather than by bouncing to sign-in; see `currentSession()` for why
 * conflating the two locks a rider out in a dead spot.
 *
 * THE ROLE CHECK IS SEPARATE FROM THE SESSION CHECK AND BOTH ARE NEEDED. A signed-in
 * non-rider is not refused by the API; `index()` filters on `rider_id` from the session, so
 * they get an empty list — which on this screen is indistinguishable from a rider who has
 * had three quiet days. See `AccessNotice`.
 *
 * NOT CACHED, AND NOTHING HERE SHOULD MAKE IT SO. The screen reads cookies through the API
 * client, so it is dynamic already. A cached page here would be one rider's finished round
 * served to another.
 */
export const metadata: Metadata = { title: 'Completed' }

export default async function CompletedPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>
}) {
  const [session, params] = await Promise.all([currentSession(), searchParams])

  if (session.state === 'guest') {
    redirect(SIGN_IN_PATH)
  }

  if (session.state === 'unreachable') {
    /*
     * NO SIGN-OUT BUTTON IN THIS BRANCH, and its absence is the point — the same decision
     * /assignments makes. Signing out clears the cookie jar whether or not the API answers,
     * so from here it would work, and would leave the rider unable to sign back in until
     * they found signal, having lost a session that was never actually broken.
     */
    return (
      <FieldShell active="completed">
        <AccessNotice reason="unreachable" message={session.message} />
      </FieldShell>
    )
  }

  const rider = session.rider

  return (
    <FieldShell active="completed">
      {rider.password_change_required ? (
        <AccessNotice reason="password_change_required" />
      ) : !isRider(rider) ? (
        <AccessNotice reason="not_a_rider" />
      ) : (
        <CompletedScreen paths={DELIVERY_PATHS} cursor={params.cursor} />
      )}

      {/* Composed HERE rather than rendered by the delivery domain, which has no business
          knowing there is such a thing as a session. Shown in every branch above: a rider
          who cannot use this app still needs the way out of it, and on a shared handset the
          name beside it is the only clue that somebody else is signed in. */}
      <SignOutButton name={rider.name} />
    </FieldShell>
  )
}
