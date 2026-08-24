'use client'

import type { ReactElement } from 'react'
import { Button } from '@carevelo/ui'
import { ConsoleErrorScreen } from '../error'

/**
 * The console's sign-in screen itself failed to render.
 *
 * WHY THIS ROUTE GETS ITS OWN BOUNDARY. The app-level screen offers the schedule and "Sign in
 * again", and both are wrong here for the same reason: the schedule has a session guard that
 * sends a signed-out member of staff straight back to /sign-in, and "Sign in again" is a link
 * to the page that has just broken. Somebody at a front desk at half past seven in the
 * morning would press one, arrive back here, and press it again. `components/sections.ts`
 * records what a link that goes nowhere honest does to this console's credibility, and a link
 * that goes in a circle is the sharpest version of that.
 *
 * So the only way forward is the retry, and the way out is the clinic's own front door rather
 * than a console route: this app is served on the clinic's subdomain, and a member of staff
 * who cannot get in needs the clinic administrator, not another screen.
 *
 * IT COVERS `sign-in/new-password` TOO, which is the sharper case of the two. That screen is
 * reached by a forced redirect for an account still holding its issued password — the API
 * refuses everything else until it is changed — so somebody meeting a broken page there is
 * locked out of the whole console until this screen comes back. The copy says what to do
 * about that rather than offering a route that will refuse them.
 *
 * NO CREDENTIAL, EVER. `reset()` re-renders the segment; it does not resubmit the form,
 * because a Server Action is not replayed by re-rendering the page it was invoked from. And
 * `error.message` on these routes can carry the identifier that was submitted — a member of
 * staff's own email address — onto a screen that stands on a shared desk in a waiting room.
 * It is never rendered and never logged from here; see the parent boundary for the whole rule
 * and for why `error.digest` is the one exception to it.
 */
export default function SignInError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return (
    <ConsoleErrorScreen
      title="The sign-in screen did not load"
      error={error}
      reset={reset}
      actions={
        /*
         * NO LINK TO A CONSOLE ROUTE HERE, DELIBERATELY — see the docblock. Every section in
         * this app sends a signed-out member of staff back to this page, so a button that
         * returns you to the screen you are already stuck on is how a broken page becomes a
         * broken console.
         */
        <Button variant="quiet" size="lg" href="/">
          The clinic&rsquo;s home page
        </Button>
      }
    >
      Something failed while this screen was being put together. You have not been signed in,
      nothing you typed was sent anywhere, and no session has been ended. Try once more. If it
      still will not open, tell whoever administers this clinic&rsquo;s console — nobody else
      can see that this happened to you.
    </ConsoleErrorScreen>
  )
}
