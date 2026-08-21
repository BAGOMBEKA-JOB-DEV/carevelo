'use client'

import { useEffect, useRef, type ReactElement } from 'react'
import { Button, Card, Inline, Stack } from '@carevelo/ui'

/**
 * What a member of clinic staff sees when a console screen fails to render.
 *
 * Before this file existed, Next's own error page answered instead: the framework's
 * unstyled shell, no navigation, and — in a development build — the message and the stack
 * printed onto a screen that sits on a front desk in a waiting room. This replaces it with
 * something that says what happened, offers the retry, and gives a support call something
 * to go on.
 *
 * `'use client'` AND `{ error, reset }` ARE THE FRAMEWORK CONTRACT. Next renders this as
 * the fallback of a React error boundary, and an error boundary catches at render time in
 * the browser, so there is no server-rendered variant of this file to reach for.
 *
 * ------------------------------------------------------------------------------------
 * NOTHING FROM THE ERROR OBJECT IS SHOWN EXCEPT `digest`.
 *
 * `error.message` here can hold a patient's name, an order reference, a request URL with a
 * record identifier in the path, or the API's own sentence about something this member of
 * staff may not be entitled to read. `error.stack` holds file paths and, in development,
 * source. None of it is rendered and none of it is logged from this component — the house
 * rule about clinical content in logs applies to a browser console as much as to a server
 * one, because a front-desk machine is a shared machine.
 *
 * `error.digest` is a different kind of thing: Next hashes the original error ON THE SERVER
 * and sends only the hash, exactly so a client can name a failure without holding it. It
 * matches a line in the server log and decodes to nothing by itself. It is shown, labelled
 * as the thing to quote, because "the payments page was broken this morning" is not
 * something anybody can find in a log and a digest is.
 * ------------------------------------------------------------------------------------
 *
 * IT DOES NOT RENDER ConsoleShell, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE.
 * This file is a client component, so anything it imports joins the route's client bundle.
 * `ConsoleShell` imports `components/sections.ts` — 11.7KB of source, a lede, a caution and
 * a list of planned screens per section — to produce six navigation links. Paying that on
 * every console route, forever, to decorate a screen almost nobody reaches is the wrong
 * trade. `loading.tsx` renders the full shell instead, and can, because it is a server
 * component and costs the browser nothing.
 *
 * So the way out is explicit instead of implied: the retry, the schedule, and sign-in.
 * `/sign-in` is offered because a failed read is very often an expired session, and it is a
 * route that actually exists here — `components/sections.ts` records what a link that goes
 * nowhere honest does to a console's credibility.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  /*
   * Focus moves to the heading once, on mount.
   *
   * An error boundary replaces the page underneath the reader without a navigation, so
   * nothing is announced and focus stays on a control that no longer exists — leaving
   * somebody on a screen reader tabbing around a page they were never told they had
   * arrived at. Moving focus to the <h1> is what a real navigation would have done, and it
   * is deterministic in a way a live region is not: an `role="alert"` here would announce
   * when the boundary swaps in the browser and stay silent if the same markup were ever
   * present in the document at parse time. `tabIndex={-1}` makes the heading focusable
   * programmatically without ever putting it in the tab order.
   */
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <main className="content" id="main">
      <Card>
        <Stack gap="5">
          {/* A real <h1>: this screen replaced a page that had one, and a document with no
              heading is a document with no outline. `.title` because the reset strips
              heading sizes and `.page-head h1` only dresses a heading inside a page head,
              which this is not. */}
          <h1 className="title" ref={heading} tabIndex={-1}>
            This page did not load
          </h1>

          <p className="muted">
            Something failed while this screen was being put together. Nothing you were
            looking at has been changed, and nothing has been sent to a patient or a rider.
            Try once more — a read that did not come back is the ordinary cause, and it
            often succeeds on the second attempt.
          </p>

          <Inline gap="4">
            {/* `type="button"`: not in a form today, and must not become a submit if it
                ever ends up inside one. */}
            <Button variant="primary" size="lg" type="button" onClick={reset}>
              Try again
            </Button>
            <Button variant="quiet" size="lg" href="/schedule">
              Go to the schedule
            </Button>
            <Button variant="ghost" size="lg" href="/sign-in">
              Sign in again
            </Button>
          </Inline>

          {/* Only the digest, only when the server produced one. It is absent for an error
              thrown in the browser, so this is conditional rather than a line that
              sometimes has nothing after the colon. */}
          {error.digest === undefined ? null : (
            <p className="fine">
              If you report this, quote <span className="mono">{error.digest}</span>. It
              identifies this one failure in the server log and holds nothing about the
              patient or the record the screen was reading.
            </p>
          )}
        </Stack>
      </Card>
    </main>
  )
}
