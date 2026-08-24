'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Asks the SERVER, on a timer, whether this rider's assignments have changed.
 *
 * ==================================================================
 * THE ONLY 'use client' IN THIS APP, AND IT RENDERS NOTHING.
 * ==================================================================
 *
 * Everything else on this surface is a server component and a plain form post, because a
 * rider standing outside a pharmacy at the start of a shift should not be waiting for a
 * JavaScript bundle before they can see their round or press a button. This file is the
 * one exception, and it earns it: work is assigned to a rider by a DISPATCHER, on another
 * screen, at a moment the rider's phone knows nothing about. Something has to ask again.
 *
 * `router.refresh()` re-runs the server render of the current route, which re-fetches
 * `GET /v1/rider/deliveries` server-side and streams back a new RSC payload. It is
 * deliberately NOT a fetch to the API, and three things follow from routing the poll
 * through our own server instead of the browser:
 *
 *  - The session cookie, the clinic's host and the CSRF token stay in the one place that
 *    already assembles them. The browser never talks to the API directly.
 *  - `connect-src` in src/proxy.ts is `'self' ws: wss:`, and in development the API is on
 *    another port — a browser fetch there is blocked, and would look exactly like a rider
 *    whose assignments never arrive. This cannot hit that.
 *  - This component never sees a delivery payload AT ALL. It cannot render a recipient, an
 *    address or a status, because it is never given one. On the most minimised surface in
 *    the product that property is worth more than the convenience it costs: the only code
 *    that can put a patient's name on this screen is the server render that just read it
 *    from the rider endpoint.
 *
 * ==================================================================
 * POLLING IS NOT THE FALLBACK. IT IS THE FLOOR.
 * ==================================================================
 *
 * `@carevelo/realtime` publishes `delivery.assigned` on `tenant.{clinic}.rider.{rider}` —
 * `RiderChannel`, which admits the rider whose channel it is and nobody else, and whose
 * frames carry an identifier and nothing more. Wiring it here would be four lines:
 * subscribe in this effect, and make the callback call `router.refresh()` — the SAME call
 * the timer makes, because a hint and a tick deserve identical treatment. A frame is a
 * hint to re-fetch and never the thing itself, and the shape of this component is what
 * makes that rule free rather than a discipline: there is no payload to be tempted by.
 *
 * It is not wired today because `@carevelo/realtime` is not a dependency of this app —
 * apps/rider-view declares only `@carevelo/api-client` and `@carevelo/ui` — and adding it
 * is a lockfile change. Nothing here waits on it. The socket may be unavailable, and in
 * production today it is: the backend still ships `BROADCAST_CONNECTION=log`. A rider's
 * round must work with it absent, so this timer is the baseline and the socket, when it
 * arrives, only makes the same refresh happen sooner.
 *
 * ==================================================================
 * WHAT THE INTERVAL COSTS, IN A RIDER'S OWN MONEY.
 * ==================================================================
 *
 * 30 seconds, and it is twice the 15 the realtime wrapper defaults to when there is no
 * socket. That default is tuned for a pharmacy queue on a desk, watched by somebody whose
 * data is the clinic's. This screen is open for a twelve-hour shift on a rider's own
 * metered bundle, and a new assignment arriving up to thirty seconds later costs nobody
 * anything — a rider is riding, not staring at a list. Halving the interval would double
 * a bill somebody pays personally in exchange for freshness nothing can use.
 *
 * A HIDDEN TAB IS NOT POLLED AT ALL, which is what makes the arithmetic bearable: for
 * most of a shift the phone is in a pocket with the screen off, and the listener below
 * reconciles the moment it comes back, so nothing is lost by the silence.
 */

/** @see the note above for why this is 30s and not the wrapper's 15s. */
const EVERY_MS = 30_000

export function AssignmentsRefresher() {
  const router = useRouter()

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    let stopped = false

    const start = (): void => {
      if (stopped || timer !== undefined) {
        return
      }

      timer = setInterval(() => {
        if (!stopped) {
          router.refresh()
        }
      }, EVERY_MS)
    }

    const stop = (): void => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        stop()

        return
      }

      // Immediately, then resume the clock. A rider taking their phone out of a pocket
      // wants what is true now, not what was true thirty seconds before they looked.
      router.refresh()
      start()
    }

    /*
     * Coming back onto the network is the other moment worth spending a request on, and
     * it is the common one here: a rider passes through a dead spot several times an
     * hour. `online` fires when the handset reattaches, which is exactly when the last
     * few ticks will have quietly failed.
     */
    const onOnline = (): void => {
      if (!stopped && !document.hidden) {
        router.refresh()
      }
    }

    if (!document.hidden) {
      start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)

    return () => {
      stopped = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [router])

  return null
}
