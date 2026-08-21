import { Notice, PageHeader } from '@carevelo/ui'

/**
 * A session that cannot be used on this surface right now, and why.
 *
 * ==================================================================
 * WHY THIS EXISTS INSTEAD OF AN EMPTY LIST
 * ==================================================================
 *
 * All three cases below end with a screen that has nothing on it — and "nothing" on a
 * rider's screen is indistinguishable from a quiet morning. A rider who believes they have
 * no deliveries does not telephone anybody; they wait. So every state that is not "no work
 * today" says so out loud.
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
 * `unreachable` — the API could not be asked at all, which outdoors is the common case and
 * not an exception. It is deliberately NOT treated as being signed out: sending a rider to
 * the sign-in screen would tell them their session had ended when it had not, and the
 * screen they landed on could not work either, since signing in needs the same API. Some
 * of them would then sign out to "fix" it and be locked out until they found signal.
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
 * ==================================================================
 * EACH BRANCH RENDERS THE PAGE'S `<h1>`, AND NONE OF THEM USED TO.
 * ==================================================================
 *
 * This component is rendered INSTEAD of a screen, not beside one — `/assignments` and
 * `/assignments/[delivery]` both return `<FieldShell><AccessNotice/></FieldShell>` and
 * nothing else. So while it rendered a bare `<Notice>`, all three of these states produced
 * a page with no heading at all: nothing for a screen-reader user to jump to, and a
 * document that announces as a fragment of something larger rather than as a page.
 *
 * That is the worst possible place for it. `unreachable` is not an edge case on this
 * surface — it is what a rider sees every time they pass through a dead spot, several times
 * an hour — and it is precisely the moment somebody needs to be told plainly where they are
 * and that nothing is broken. The `<h1>` is the first thing that says it.
 *
 * `PageHeader` takes `title: string`, so each branch renders exactly one `<h1>` and cannot
 * render two. The sentence that was the notice's `title` is now the heading, and the notice
 * keeps the detail — which also means the state is stated once in the page outline and once
 * in prose, rather than only inside a box a heading-navigation pass walks straight past.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
export function AccessNotice({
  reason,
  message,
}: {
  reason: 'not_a_rider' | 'password_change_required' | 'unreachable'
  /**
   * The API's own sentence, where there was one. Only meaningful for `unreachable`.
   *
   * `null` AS WELL AS `undefined`, because the two callers genuinely produce it: `null` is
   * how `Attempt` and `Session` say "the request never reached the API, so there is no
   * sentence to pass on". Narrowing this to `string | undefined` would push a `?? undefined`
   * onto every call site, which is the kind of conversion that becomes `?? ''` and then
   * renders an empty notice.
   */
  message?: string | null | undefined
}) {
  if (reason === 'unreachable') {
    return (
      <>
        <PageHeader
          title="Cannot reach the clinic system"
          description="Nothing has been lost and nothing has changed."
        />

        <Notice tone="warn" icon="activity">
          {/*
          "PULL DOWN", NOT "IT WILL REFRESH ITSELF". The 30-second refresher lives inside
          the assignments screen, and this notice is rendered INSTEAD of that screen — so
          nothing on this page is retrying, and promising otherwise would leave a rider
          waiting at a screen that has stopped asking.
        */}
          {message ??
            'The clinic’s system could not be reached from this phone. Pull the page down to '
              + 'try again once you have signal, and if you are signed in, stay signed in — '
              + 'you will not be able to sign back in until the connection returns.'}
        </Notice>
      </>
    )
  }

  if (reason === 'password_change_required') {
    return (
      <>
        <PageHeader
          title="Your password needs changing first"
          description="Your deliveries are waiting and nothing has been lost."
        />

        <Notice tone="warn" icon="lock">
          Your clinic has asked for a new password on this account. This app cannot set one —
          sign in to the clinic system to change it, then come back here.
        </Notice>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="This app is for riders"
        description="This is not an error, and your other work is unaffected."
      />

      <Notice tone="info" icon="truck">
        You are signed in, but this account is not a delivery rider for this clinic — so
        there is nothing here for it. Ask your clinic administrator if you think that is
        wrong.
      </Notice>
    </>
  )
}
