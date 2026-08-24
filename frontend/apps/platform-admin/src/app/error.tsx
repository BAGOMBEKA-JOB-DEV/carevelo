'use client'

import { useEffect, useRef, type ReactElement } from 'react'
import { Button, Card, Inline, Stack } from '@carevelo/ui'

/**
 * What an operator sees when a control-plane screen fails to render.
 *
 * Before this file existed the answer was Next's built-in error page: the framework's own
 * shell, no navigation, and in a development build the message and the stack printed out.
 * On this surface that is a sharper problem than it looks. The control plane's errors carry
 * TENANT identifiers — which clinic was being read, which grant was being requested — and
 * this is the one app in the product whose whole job is to operate on other people's
 * clinics. A screen that prints an exception here is a screen that names a customer.
 *
 * `'use client'` AND `{ error, reset }` ARE THE FRAMEWORK CONTRACT. Next renders this as
 * the fallback of a React error boundary, and an error boundary catches at render time in
 * the browser, so there is no server-rendered variant of this file to reach for.
 *
 * ------------------------------------------------------------------------------------
 * NOTHING FROM THE ERROR OBJECT IS SHOWN EXCEPT `digest`.
 *
 * `error.message` here can hold a clinic's trading name, a tenant id, a break-glass grant
 * reference, a request URL with any of those in the path, or the API's own sentence about
 * something this operator's role is not entitled to. `error.stack` holds file paths and, in
 * development, source. None of it is rendered and none of it is logged from this component.
 *
 * `error.digest` is different in kind: Next hashes the original error ON THE SERVER and
 * sends only the hash to the browser, precisely so a client can name a failure without
 * holding its contents. It matches one line in the server log and decodes to nothing by
 * itself. It is shown and labelled as the thing to quote, because an incident report that
 * says "tenants was broken this afternoon" is not something anybody can find in a log.
 *
 * NO CLINICAL CONTENT, and on this surface that is guaranteed twice over: the control plane
 * reaches no clinic's clinical data without a break-glass grant, and this component reaches
 * nothing at all.
 * ------------------------------------------------------------------------------------
 *
 * IT DOES NOT RENDER `ControlPlaneShell`, FOR THE REASON `clinic-console/src/app/error.tsx`
 * SETS OUT. This file is a client component, so everything it imports joins the route's
 * client bundle, and this app ships one client component in total — the theme toggle. The
 * shell and the nav data behind it are server-rendered on every other route and would stop
 * being so the moment this file imported them, on every route at once, to decorate a screen
 * almost nobody reaches.
 *
 * The number that used to be attached to this paragraph is gone with the thing it measured:
 * `components/sections.ts` carried a lede, a caution and three planned-screen paragraphs per
 * section — roughly nine kilobytes of prose — to produce three navigation links, and it was
 * trimmed to a label and a route when the last planned section became a real screen. The
 * argument stands without the number, which is why it is still here. `loading.tsx` renders
 * the full frame instead, as it always could, because it is a server component.
 *
 * So the ways out are stated rather than implied by a sidebar: the retry, the register, and
 * the overview. All three are routes that exist. `sections.ts` records what happened the
 * last time this app's navigation pointed at routes that did not.
 *
 * IT SAYS WHAT DID NOT HAPPEN, WHICH IS THE FACT AN OPERATOR ACTUALLY NEEDS. Provisioning,
 * suspension and a break-glass request are all writes, and an operator who cannot tell
 * whether the one they just submitted went through will submit it again. A second grant
 * request is a second audit entry against a real clinic; a second suspension is a clinic
 * told twice. `reset()` re-renders the segment — a read — and re-rendering the page a
 * Server Action was invoked from does not replay the action, so the retry itself is safe.
 */
export default function PlatformError({
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
   * nothing is announced and focus stays on whatever the old page had — frequently a
   * control that no longer exists. Moving focus to the <h1> is what a real navigation would
   * have done, and it is deterministic in a way a live region is not: `role="alert"`
   * announces when the boundary swaps in the browser and stays silent if the same markup is
   * ever present at parse time. `tabIndex={-1}` makes the heading focusable
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
            This screen did not load
          </h1>

          <p className="muted">
            Something failed while this screen was being put together. No clinic was
            provisioned, suspended or resumed by this, no break-glass grant was created, and
            nothing was sent to any clinic. If you had just submitted something, check the
            register or the grant list before submitting it again rather than repeating it —
            a request that did go through and is repeated is a second entry in the audit
            trail against a real clinic.
          </p>

          <Inline gap="4">
            {/* `type="button"`: not in a form today, and must not become a submit if it
                ever ends up inside one. */}
            <Button variant="primary" size="lg" type="button" onClick={reset}>
              Try again
            </Button>
            <Button variant="quiet" size="lg" href="/tenants">
              Go to the register
            </Button>
            <Button variant="ghost" size="lg" href="/">
              Platform overview
            </Button>
          </Inline>

          {/* Only the digest, only when the server produced one. It is absent for an error
              thrown in the browser, so this is conditional rather than a line that
              sometimes has nothing after it. */}
          {error.digest === undefined ? null : (
            <p className="fine">
              If you report this, quote <span className="mono">{error.digest}</span>. It
              identifies this one failure in the server log and holds nothing about the
              clinic the screen was reading.
            </p>
          )}
        </Stack>
      </Card>
    </main>
  )
}
