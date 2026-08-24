'use client'

import { useEffect, useRef, type ReactElement } from 'react'
import { Button, Card, Inline, Stack } from '@carevelo/ui'

/**
 * What an operator sees when the audit register fails to render.
 *
 * WHY THIS ROUTE HAS ITS OWN BOUNDARY WHEN THE APP ALREADY HAS ONE. `app/error.tsx` is
 * written about WRITES — "no clinic was provisioned, suspended or resumed by this, no
 * break-glass grant was created, and nothing was sent to any clinic" — and its advice is to
 * check the register before submitting again. None of that is the reassurance somebody
 * needs here. This route submits nothing. What an operator needs to be told on this screen
 * is the opposite thing, and it is the thing they will otherwise get wrong:
 *
 *   A FAILURE TO READ THE TRAIL IS NOT AN EMPTY TRAIL.
 *
 * "I looked and there was nothing" is a conclusion people act on during an incident, and it
 * is the one conclusion this screen must never be able to produce by accident. The audit
 * log is append-only and nothing that happened here removed anything from it.
 *
 * The other half is worth stating too: the read that failed may still have been RECORDED.
 * The API audits the read before it renders anything, so a failure in this browser does not
 * mean the entry is absent from the trail — which matters to whoever reviews it later and
 * finds an `audit_log.read` with no operator remembering it.
 *
 * `'use client'` AND `{ error, reset }` ARE THE FRAMEWORK CONTRACT: Next renders this as the
 * fallback of a React error boundary, which catches at render time in the browser, so there
 * is no server-rendered variant to reach for.
 *
 * ------------------------------------------------------------------------------------
 * NOTHING FROM THE ERROR OBJECT IS SHOWN EXCEPT `digest`.
 *
 * On this route `error.message` can hold a tenant id, an actor id, an action name or the
 * request URL with all three in it — which is to say, it can name the clinic somebody was
 * investigating. `error.digest` is different in kind: Next hashes the original error ON THE
 * SERVER and sends only the hash, so it names one line in the server log and decodes to
 * nothing by itself.
 * ------------------------------------------------------------------------------------
 *
 * IT DOES NOT RENDER `ControlPlaneShell`, for the reason `app/error.tsx` gives: this is a
 * client component, so anything it imports joins the route's client bundle, and this app
 * ships one client component in total. The ways out are stated instead — the retry, the
 * register, and the overview, all routes that exist.
 */
export default function AuditError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  /*
   * Focus moves to the heading once, on mount. An error boundary swaps the page out
   * underneath the reader without a navigation, so nothing is announced and focus stays on
   * whatever the old page had — frequently a filter control that no longer exists.
   */
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <main className="content" id="main">
      <Card>
        <Stack gap="5">
          <h1 className="title" ref={heading} tabIndex={-1}>
            The audit trail could not be read
          </h1>

          <p className="muted">
            Something failed while this screen was being put together.{' '}
            <strong>This is not an empty trail.</strong> Nothing was read, so nothing follows
            from it about what is or is not recorded — and nothing here removed anything: the
            audit log is append-only and no role in the product can write to it or delete
            from it. If you are working an incident, treat this as a screen that did not
            answer rather than as an answer.
          </p>

          <p className="muted">
            The read itself may still have been recorded. The API writes an entry when a
            trail is read, before this screen renders any of it, so an{' '}
            <span className="mono">audit_log.read</span> entry naming you may exist for an
            attempt you never saw the result of.
          </p>

          <Inline gap="4">
            {/* `type="button"`: not in a form today, and must not become a submit if it
                ever ends up inside one. */}
            <Button variant="primary" size="lg" type="button" onClick={reset}>
              Try again
            </Button>
            <Button variant="quiet" size="lg" href="/audit">
              Start from the platform trail
            </Button>
            <Button variant="ghost" size="lg" href="/">
              Platform overview
            </Button>
          </Inline>

          {error.digest === undefined ? null : (
            <p className="fine">
              If you report this, quote <span className="mono">{error.digest}</span>. It
              identifies this one failure in the server log and holds nothing about the
              clinic whose trail was being read.
            </p>
          )}
        </Stack>
      </Card>
    </main>
  )
}
