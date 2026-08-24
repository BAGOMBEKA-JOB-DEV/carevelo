'use client'

import { useEffect, useRef, type ReactElement } from 'react'
import { Button, Card, Stack } from '@carevelo/ui'

/**
 * What a rider sees when a screen in this app fails to render.
 *
 * THIS IS THE LAST NET, NOT THE FIRST ONE, AND THAT DISTINCTION IS THE WHOLE DESIGN OF
 * THIS SURFACE. Every read on the rider view already goes through `attempt()`, precisely
 * so that a request which did not come back leaves the frame, the tab bar and the sign-out
 * in place and says what happened — `AssignmentsScreen` argues that case at length, and
 * `assignments/[delivery]/page.tsx` repeats it for the one read a rider cannot do without.
 * So a rider should almost never arrive here. What is left for this file to catch is the
 * unexpected throw: a render that went wrong, a shape the API sent that the screen could
 * not use, a bug. Without it those become Next's built-in error page — unstyled, no
 * navigation, and in a development build the message and the stack printed on a phone that
 * is being held at a stranger's gate.
 *
 * `'use client'` AND `{ error, reset }` ARE THE FRAMEWORK CONTRACT. Next renders this as
 * the fallback of a React error boundary; an error boundary catches at render time in the
 * browser, so there is no server-rendered variant of this file to reach for.
 *
 * ------------------------------------------------------------------------------------
 * NOTHING FROM THE ERROR OBJECT IS SHOWN EXCEPT `digest`.
 *
 * `error.message` on this surface can carry a package reference, a recipient's name, a
 * request URL with a delivery identifier in the path, or the API's own sentence written
 * for an operator. `error.stack` carries file paths and, in development, source. None of
 * it is rendered here and none of it is logged from here — the rider payload rule is that
 * a delivery's identifiers do not travel any further than the screen that needs them, and
 * a browser console on a shared handset is further.
 *
 * `error.digest` is different in kind: Next hashes the original error ON THE SERVER and
 * sends only the hash, exactly so that a client can name a failure without holding it. It
 * matches one line in the server log and decodes to nothing on its own. It is shown, and
 * labelled as the thing to read out, because a rider telephoning the clinic to say "the
 * app broke" gives a dispatcher nothing to look for and a code gives them a line.
 *
 * NO CLINICAL CONTENT, and there is none to leak: this component cannot reach a delivery,
 * so there is no branch below where a medicine, a diagnosis or a note could appear. The
 * copy also never names what the rider was doing, because "your delivery could not be
 * opened" already says a delivery exists.
 * ------------------------------------------------------------------------------------
 *
 * IT DOES NOT RENDER `FieldShell`, FOR THE REASON `clinic-console/src/app/error.tsx` SETS
 * OUT. This file is a client component, so everything it imports joins the route's client
 * bundle — and `FieldShell` imports `components/sections.ts`, which carries a lede, a
 * caution and a list of planned screens per section in order to produce two navigation
 * links. This app ships almost no client JavaScript on purpose, for a rider on a mid-range
 * Android paying for their own data, and paying that weight on every route to decorate a
 * screen almost nobody reaches is the wrong way round. The frame's two wrapper elements
 * are rendered by hand instead, so the page still has the app's padding and full height,
 * and the way out is stated explicitly rather than implied by a tab bar.
 *
 * ONE WAY OUT, FULL WIDTH, AT THE BOTTOM. Same shape as `not-found.tsx`: the thumb is
 * already at the bottom of the phone, and a small centred link is a mis-tap. The retry
 * comes first because it is what usually works — `reset()` re-renders the segment, which
 * on this surface is a read and never a status change, so pressing it cannot record
 * anything twice.
 */
export default function RiderError({
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
   * nothing is announced and focus stays on whatever the old page had — often a control
   * that no longer exists. Moving focus to the <h1> is what a real navigation would have
   * done, and it is deterministic in a way a live region is not: `role="alert"` announces
   * when the boundary swaps in the browser and says nothing if this markup is ever present
   * at parse time. `tabIndex={-1}` makes the heading focusable programmatically without
   * ever putting it into the tab order.
   *
   * A plain <h1> rather than `PageHeader`, which is what `not-found.tsx` uses: PageHeader
   * takes `title: string` and forwards no ref, and there is nowhere to attach one without
   * changing a component four apps share for the sake of this screen. `.title` because the
   * reset strips heading sizes and `.page-head h1` only dresses a heading inside a page
   * head, which this is not.
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
            <h1 className="title" ref={heading} tabIndex={-1}>
              This screen did not open
            </h1>

            <p className="muted">
              Something went wrong while this screen was being put together. Your round has
              not changed and nothing has been recorded — a delivery you have not marked is
              still waiting for you. Try once more, and if it still will not open, telephone
              the clinic and carry on with the package you are holding.
            </p>

            {/* `type="button"`: not in a form today, and must not become a submit if it
                ever ends up inside one. */}
            <Button variant="primary" size="lg" type="button" onClick={reset} block>
              Try again
            </Button>

            <Button variant="quiet" size="lg" href="/assignments" block>
              My deliveries
            </Button>

            {/* Only the digest, only when the server produced one. It is absent for an
                error thrown in the browser, so this is conditional rather than a line that
                sometimes has nothing after it. */}
            {error.digest === undefined ? null : (
              <p className="fine">
                If you telephone about this, read them this code:{' '}
                <span className="mono">{error.digest}</span>. It points the clinic&rsquo;s
                engineers at this one failure and holds nothing about you, the recipient or
                the package.
              </p>
            )}
          </Stack>
        </Card>
      </main>
    </div>
  )
}
