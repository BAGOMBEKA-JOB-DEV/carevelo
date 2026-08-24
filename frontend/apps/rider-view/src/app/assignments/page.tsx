import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FieldShell } from '@/components/FieldShell'
import { AssignmentsScreen } from '@/domains/delivery'
import { AccessNotice, SignOutButton, currentSession, isRider } from '@/domains/identity'
import { DELIVERY_PATHS, SIGN_IN_PATH } from '@/app/paths'

/**
 * The rider's round.
 *
 * Thin by design: resolve who is signed in, decide whether they may be here, and hand off
 * to the domains. The route holds no logic of its own, which the boundary rules enforce.
 *
 * THE SESSION CHECK ASKS THE API RATHER THAN READING THE COOKIE. A cookie is opaque and
 * cannot know it has been invalidated — sessions end on password change, role change,
 * deactivation and tenant suspension — and a rider whose role was revoked this morning
 * must not be shown a round.
 *
 * ONLY A GUEST IS REDIRECTED. A session that could not be READ is a third state and is
 * handled on this page rather than by bouncing to sign-in; see `currentSession()` for why
 * conflating the two locks a rider out of their own round in a dead spot.
 *
 * THE ROLE CHECK IS SEPARATE FROM THE SESSION CHECK AND BOTH ARE NEEDED. A signed-in
 * non-rider is not refused by the API; `RiderDeliveryController::index()` filters on
 * `rider_id`, so they get an empty list — which on this screen is indistinguishable from a
 * quiet morning. See `AccessNotice`.
 *
 * NOT CACHED, AND NOTHING HERE SHOULD MAKE IT SO. The screen reads cookies through the
 * API client, so it is dynamic already. A rider is watching this list for a change.
 */
export const metadata: Metadata = { title: 'Assignments' }

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string
    done?: string
    problem?: string
    message?: string
  }>
}) {
  const [session, params] = await Promise.all([currentSession(), searchParams])

  if (session.state === 'guest') {
    redirect(SIGN_IN_PATH)
  }

  if (session.state === 'unreachable') {
    /*
     * NO SIGN-OUT BUTTON IN THIS BRANCH, and its absence is the point. Signing out clears
     * the cookie jar whether or not the API answers, so from here it would work — and
     * would leave the rider unable to sign back in until they found signal, having lost a
     * session that was never actually broken. The notice says to wait, so the screen does
     * not offer the one action that would make waiting impossible.
     */
    return (
      <FieldShell active="assignments">
        <AccessNotice reason="unreachable" message={session.message} />
      </FieldShell>
    )
  }

  const rider = session.rider

  return (
    <FieldShell active="assignments">
      {rider.password_change_required ? (
        <AccessNotice reason="password_change_required" />
      ) : !isRider(rider) ? (
        <AccessNotice reason="not_a_rider" />
      ) : (
        <AssignmentsScreen
          paths={DELIVERY_PATHS}
          cursor={params.cursor}
          done={params.done}
          problem={params.problem}
          message={params.message}
        />
      )}

      {/* Composed HERE rather than rendered by the delivery domain, which has no business
          knowing there is such a thing as a session. Shown in every branch above: a rider
          who cannot use this app still needs the way out of it, and on a shared handset
          the name beside it is the only clue that somebody else is signed in. */}
      <SignOutButton name={rider.name} />
    </FieldShell>
  )
}
