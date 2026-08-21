'use client'

import { useEffect, useRef, type ReactElement } from 'react'
import { Button, Card, Inline, Stack } from '@carevelo/ui'
import { DELIVERY_PATHS } from '@/app/paths'

/**
 * What a rider sees when a screen fails to render.
 *
 * `'use client'` AND `{ error, reset }` ARE THE FRAMEWORK CONTRACT. Next renders this as
 * the fallback of a React error boundary, and an error boundary catches at render time in
 * the browser; there is no server-rendered variant of this file to reach for.
 *
 * ------------------------------------------------------------------------------------
 * IT IS AS INCURIOUS AS not-found.tsx, AND FOR THE SAME REASON.
 *
 * `not-found.tsx` on this surface refuses to distinguish a delivery that never existed from
 * one belonging to another rider, because a page that said "that delivery is not yours"
 * would confirm the record exists somewhere — which is how somebody learns that a named
 * person is a patient of some other clinic. A failure has to hold the same line. This
 * screen therefore says only that the page did not load. It names no delivery, no
 * recipient, no address, and no reason.
 *
 * WHICH IS ALSO WHY `error.message` NEVER REACHES IT. On this surface a message can carry a
 * recipient's name, an address, or the API's sentence about a delivery this rider is not
 * entitled to see — and the rider rule in the data-protection document is written precisely
 * against details leaking onto a handset that is often shared and often borrowed.
 * `error.stack` is not rendered either.
 *
 * `error.digest` IS shown. Next hashes the original error ON THE SERVER and sends only the
 * hash, so it names a failure without holding one; it matches a line in the server log and
 * decodes to nothing on its own. A rider telephoning the clinic with "it would not open"
 * gives support nothing to work with; the same call with a digest gives them the line.
 * ------------------------------------------------------------------------------------
 *
 * NO FieldShell, WHICH IS WHERE THIS PARTS COMPANY WITH not-found.tsx AND assignments/
 * loading.tsx — BOTH OF WHICH DO RENDER IT. Those two are server components, so the shell
 * costs the handset nothing. This one is a client component, and everything it imports
 * joins the route's JavaScript: `FieldShell` pulls in `components/sections.ts`, whose
 * per-section prose is there for the planned-section screens and not for the two tab
 * labels a frame needs. Sending that to a phone on mobile data, on every route, to decorate
 * a screen almost nobody reaches is the wrong trade — so the frame's COLUMN is reproduced
 * with the same CSS classes, which cost nothing, and the one way out is a real button.
 */
export default function FieldError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  /*
   * Focus moves to the heading once, on mount. An error boundary swaps the page out
   * without a navigation, so nothing announces and focus stays on a control that no longer
   * exists. `tabIndex={-1}` makes the heading focusable programmatically without ever
   * putting it in the tab order.
   */
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    /* `.fieldview` and `.fieldview__main` are the frame's own classes — the 560px column,
       the canvas behind it, the field padding. Pure CSS, so the column is right without
       importing the component that usually renders it. */
    <div className="fieldview">
      <main className="fieldview__main" id="main">
        <Card>
          <Stack gap="5">
            <h1 className="title" ref={heading} tabIndex={-1}>
              This did not load
            </h1>

            <p className="muted">
              The page could not be opened just now. Nothing you have recorded has been lost
              and nothing has been sent. Try again — a request that did not come back is the
              usual cause out here, and it often works on the second try.
            </p>

            <Inline gap="4">
              {/* `type="button"`: not in a form, and must not become a submit if it ever
                  ends up inside one. `size="lg"` because this is pressed with a thumb. */}
              <Button variant="primary" size="lg" type="button" onClick={reset}>
                Try again
              </Button>
              <Button variant="quiet" size="lg" href={DELIVERY_PATHS.assignments}>
                My deliveries
              </Button>
            </Inline>

            {/* Only the digest, only when the server produced one. */}
            {error.digest === undefined ? null : (
              <p className="fine">
                If you telephone the clinic about this, read them{' '}
                <span className="mono">{error.digest}</span>. It says nothing about the
                delivery or the person waiting for it.
              </p>
            )}
          </Stack>
        </Card>
      </main>
    </div>
  )
}
