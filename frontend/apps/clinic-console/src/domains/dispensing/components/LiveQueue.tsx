'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Keeps the pharmacy queue current, and renders one line saying how.
 *
 * ------------------------------------------------------------------
 * 'use client' IS EARNED HERE AND NOWHERE ELSE IN THIS DOMAIN. Every other file is a
 * Server Component: they read the API with the pharmacist's session, render, and stop.
 * This one needs a timer and the page's visibility, neither of which exists on the server.
 *
 * ------------------------------------------------------------------
 * POLLING IS NOT THE FALLBACK. IT IS THE FLOOR.
 *
 * `packages/realtime/README.md` is emphatic about this and it is the thing most likely to
 * be got backwards: "This is a periodic refresh that goes quiet while a socket is
 * delivering — not a websocket with a fallback bolted on. Get that the wrong way round and
 * you will write a screen that waits for a frame that never comes."
 *
 * The acceptance criterion is that Reverb being unavailable degrades to polling and NEVER
 * blocks a dispensing action. So this component is the mechanism, not the safety net, and
 * the queue is fully usable with no socket at all — which is its state in production
 * today, where the backend still ships `BROADCAST_CONNECTION=log` and nothing reaches a
 * socket whatsoever.
 *
 * ------------------------------------------------------------------
 * WHERE THE SOCKET GOES, EXACTLY.
 *
 * `@carevelo/realtime` publishes `prescription.issued`, `order.dispensed` and
 * `substitution.decided` on `realtime.pharmacyQueue()`, which is the tenant-prefixed
 * `pharmacy-queue` channel. Wiring it here is one effect:
 *
 *     const live = realtime.live({
 *       channel: realtime.pharmacyQueue(),
 *       on: EVENTS_ON['pharmacy-queue'],
 *       refresh: () => router.refresh(),
 *       onStatus: (status) => setTransport(status.transport),
 *     })
 *     return () => live.stop()
 *
 * Note what `refresh` does: exactly what the timer below does, because A FRAME IS A HINT TO
 * RE-FETCH AND NEVER THE THING ITSELF. The wrapper throws away every field but the
 * identifier, and this screen throws away even that — `router.refresh()` re-runs the server
 * render, which re-reads the API under the pharmacist's session and their policy. A queue
 * rendered from a payload would have skipped the half that checks.
 *
 * IT IS NOT WIRED TODAY BECAUSE THE PACKAGE IS NOT A DEPENDENCY OF THIS APP.
 * `apps/clinic-console/package.json` declares `@carevelo/api-client` and `@carevelo/ui`
 * only, no app in the workspace depends on `@carevelo/realtime`, and adding it is a
 * lockfile change and an install. Written down here rather than papered over. Nothing on
 * this screen waits on it.
 *
 * ------------------------------------------------------------------
 * WHY router.refresh() AND NOT A FETCH.
 *
 * Three things follow from routing the refresh through our own server:
 *
 *  - the session cookie, the clinic's host and the CSRF token stay in the one place that
 *    already assembles them (api/http.ts). The browser never talks to the API directly.
 *  - the console's CSP is `connect-src 'self' ws: wss:`, and in development the API is on
 *    another port — a browser fetch there is blocked, and would look exactly like a queue
 *    that never updates.
 *  - this component never sees an order payload, so it CANNOT render one. That property is
 *    the whole reason the file is shaped this way.
 */

/**
 * Fifteen seconds, matching `pollEveryMs` in `@carevelo/realtime`.
 *
 * Deliberately the same number as the wrapper's default rather than a tuned one, so the
 * screen behaves identically before and after the socket lands and nobody has to relearn
 * how stale the board can be. Fifteen seconds on a queue whose items take a pharmacist two
 * minutes to process is comfortably inside the noise.
 */
const POLL_EVERY_MS = 15_000

export function LiveQueue({ label }: { label: string }) {
  const router = useRouter()

  /*
   * Shown so a pharmacist can tell "nothing has arrived" from "this screen stopped
   * updating". A board that silently froze during a network outage is the failure worth
   * designing against: it looks exactly like a quiet afternoon.
   */
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)

  useEffect(() => {
    let stopped = false

    const reconcile = (): void => {
      if (stopped) {
        return
      }

      router.refresh()
      setRefreshedAt(Date.now())
    }

    /*
     * Nothing is spent on a screen nobody is looking at — a clinic's connection is metered
     * and a console left open overnight would poll four thousand times for no reader. The
     * visibility listener reconciles the instant it comes back, so a backgrounded tab
     * loses no freshness it could have used.
     */
    const tick = (): void => {
      if (!document.hidden) {
        reconcile()
      }
    }

    const onVisibilityChange = (): void => {
      if (!document.hidden) {
        reconcile()
      }
    }

    const timer = setInterval(tick, POLL_EVERY_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)

    /*
     * Not optional. Without the teardown a remounting screen accumulates timers, and this
     * screen remounts on every navigation between the queue and an order — which is what a
     * pharmacist does all day.
     */
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [router])

  return (
    <p className="muted" aria-live="polite">
      {label}
      {refreshedAt === null ? null : (
        <>
          {' '}
          {/* Rendered only after a client-side refresh, so there is no server/client
              disagreement about what time it is. A timestamp rendered on both sides is a
              hydration mismatch by construction. */}
          <span className="tnum">
            Last checked{' '}
            {new Date(refreshedAt).toLocaleTimeString('en-GB', {
              timeZone: 'Africa/Kampala',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
            .
          </span>
        </>
      )}
    </p>
  )
}
