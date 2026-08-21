import { Notice } from '@carevelo/ui'

/**
 * A valid session that still cannot be used on this surface, and why.
 *
 * ==================================================================
 * WHY THIS EXISTS INSTEAD OF AN EMPTY LIST
 * ==================================================================
 *
 * Both cases below end with the API answering, correctly, with nothing — and "nothing" on
 * a rider's screen is indistinguishable from a quiet morning. A rider who believes they
 * have no deliveries does not telephone anybody; they wait. So the two states that are not
 * "no work today" say so out loud.
 *
 * `not_a_rider` — `RiderDeliveryController::index()` filters on `rider_id` from the
 * session, so a dispatcher or a pharmacist who opens this app gets an empty list rather
 * than a refusal. That is right on the server (there is nothing to disclose) and useless
 * on the screen.
 *
 * `password_change_required` — while `password_change_required_at` is set, the API refuses
 * every authenticated request except reading the account, changing the password and
 * signing out. Every screen in this app would be an unexplained failure.
 *
 * ==================================================================
 * THERE IS NO PASSWORD FORM IN THIS APP, AND THAT IS A DECISION.
 * ==================================================================
 *
 * Riders are STAFF, and staff choose their own password when they accept the clinic's
 * invitation — `AcceptInvitationRequest` takes `password` and `password_confirmation`.
 * `password_change_required_at` is written in exactly one place in the backend,
 * `PatientAccountController`, for the patient whose account a front-desk clerk created and
 * whose temporary password was read aloud to them. A rider's account cannot reach that
 * state by any route that exists today.
 *
 * So this app does not carry a password screen for a case that cannot occur. What it
 * carries instead is an honest sentence for the day something changes, rather than the
 * silent dead end an unhandled flag would produce — a rider signing in successfully and
 * then watching every screen fail for no stated reason.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
export function AccessNotice({
  reason,
}: {
  reason: 'not_a_rider' | 'password_change_required'
}) {
  if (reason === 'password_change_required') {
    return (
      <Notice tone="warn" icon="lock" title="Your password needs changing first">
        Your clinic has asked for a new password on this account. This app cannot set one —
        sign in to the clinic system to change it, then come back here. Your deliveries are
        waiting and nothing has been lost.
      </Notice>
    )
  }

  return (
    <Notice tone="info" icon="truck" title="This app is for riders">
      You are signed in, but this account is not a delivery rider for this clinic — so
      there is nothing here for it. This is not an error, and your other work is unaffected.
      Ask your clinic administrator if you think that is wrong.
    </Notice>
  )
}
