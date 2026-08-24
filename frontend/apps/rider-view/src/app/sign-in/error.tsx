'use client'

import { useEffect, useRef, type ReactElement } from 'react'
import { Button, Card, Stack } from '@carevelo/ui'

/**
 * The sign-in screen itself failed to render.
 *
 * WHY THIS SECTION GETS ITS OWN BOUNDARY WHEN ALMOST NOTHING ELSE IN THIS APP DOES. The
 * app-level `error.tsx` offers exactly one way out — "My deliveries" — and for a rider who
 * is not signed in that link is a loop: /assignments has a session guard and sends a guest
 * straight back to /sign-in, which is the screen that has just broken. A rider standing at
 * a gate at seven in the morning would tap it, arrive back here, and tap it again. Offering
 * a route that cannot work is the specific thing `components/sections.ts` records as the
 * way a rider learns to distrust the whole surface.
 *
 * So the only way forward on this screen is the retry, and the only honest instruction
 * beside it is to telephone the clinic — which is what a rider does anyway, and which the
 * dispatcher can act on, since the dispatcher is who resets a rider's details.
 *
 * `'use client'` AND `{ error, reset }` ARE THE FRAMEWORK CONTRACT. Next renders this as
 * the fallback of a React error boundary; an error boundary catches at render time in the
 * browser, so there is no server-rendered variant of this file to reach for.
 *
 * NOTHING FROM THE ERROR OBJECT IS SHOWN EXCEPT `digest`, for the reasons the app-level
 * `error.tsx` sets out at length. On this route the message can carry the identifier that
 * was submitted — a rider's own telephone number — and a shared handset is exactly the
 * wrong place to print one. `error.digest` is a hash Next computes ON THE SERVER and sends
 * to the browser instead of the error, so it names a failure without holding it; it is the
 * one thing here that a dispatcher can find in a log.
 *
 * NO CREDENTIAL, EVER. `reset()` re-renders the segment. It does not resubmit the form —
 * a Server Action is not replayed by re-rendering the page it was invoked from — so
 * pressing it cannot send a password anywhere, and the copy does not invite a rider to
 * type one in again before the screen has come back.
 *
 * IT DOES NOT RENDER `FieldShell`, for the reason the app-level boundary sets out: this is
 * a client component, and the shell imports `components/sections.ts` in order to produce
 * two navigation links this screen would refuse to show anyway. The frame's two wrapper
 * elements are written out by hand instead, so the screen keeps the app's padding and full
 * height.
 */
export default function SignInError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  /*
   * Focus moves to the heading once, on mount.
   *
   * An error boundary swaps the page out underneath the reader without a navigation, so
   * nothing is announced and focus stays on whatever the old page had — here, very often
   * the password field of a form that no longer exists. Moving focus to the <h1> is what a
   * real navigation would have done, and it is deterministic in a way a live region is
   * not. `tabIndex={-1}` makes the heading focusable programmatically without ever putting
   * it in the tab order.
   */
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <div className="fieldview">
      <main className="fieldview__main" id="main">
        <Card>
          <Stack gap="5">
            {/* A real <h1>: this screen replaced a page that had one. `.title` because the
                reset strips heading sizes and `.page-head h1` only dresses a heading inside
                a page head, which this is not. */}
            <h1 className="title" ref={heading} tabIndex={-1}>
              The sign-in screen did not open
            </h1>

            <p className="muted">
              Something went wrong while this screen was being put together. You have not
              been signed in and nothing you typed was sent anywhere. Try once more — a
              request that did not come back is the ordinary cause and it usually works on
              the second attempt.
            </p>

            {/* `type="button"`: not in a form today, and must not become a submit if it
                ever ends up inside one. */}
            <Button variant="primary" size="lg" type="button" onClick={reset} block>
              Try again
            </Button>

            {/*
             * NO LINK TO /assignments HERE, DELIBERATELY — see the docblock. A rider who is
             * not signed in is sent straight back to this screen by that route's own guard,
             * and a button that returns you to the page you are already stuck on is how a
             * broken screen becomes a broken app.
             */}
            <p className="muted">
              If it still will not open, telephone the clinic. The dispatcher who assigns
              your deliveries can check your details and tell you what to do about the round
              you are on.
            </p>

            {/* Only the digest, only when the server produced one. It is absent for an
                error thrown in the browser, so this is conditional rather than a line that
                sometimes has nothing after it. */}
            {error.digest === undefined ? null : (
              <p className="fine">
                If you telephone about this, read them this code:{' '}
                <span className="mono">{error.digest}</span>. It points the clinic&rsquo;s
                engineers at this one failure and holds nothing about you or your telephone
                number.
              </p>
            )}
          </Stack>
        </Card>
      </main>
    </div>
  )
}
