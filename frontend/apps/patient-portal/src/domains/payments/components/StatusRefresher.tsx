'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Asks the SERVER, on a timer, whether this payment has resolved yet.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS THE ONLY CLIENT COMPONENT IN THE DOMAIN, AND WHY IT RENDERS NOTHING.
 *
 * Mobile money is genuinely asynchronous: the patient has to pick up a handset and enter a
 * PIN, and the answer arrives at the API by webhook or by the scheduled reconciliation poll,
 * whichever gets there first. Neither of those touches this browser. Something has to ask
 * again, and asking is all this does — `router.refresh()` re-runs the server render of the
 * current route, which re-fetches `GET /v1/payment-intents/{id}` server-side and streams
 * back a new RSC payload.
 *
 * THAT IS DELIBERATELY NOT A FETCH TO THE API. Three things follow from routing the poll
 * through our own server rather than the browser:
 *
 *  - The session cookie, the clinic's host and the Accept-Language header stay in the one
 *    place that already assembles them. The browser never talks to the API directly.
 *  - The portal's CSP is `connect-src 'self'`, and in development the API is on another
 *    port — a browser fetch there is blocked, and would look exactly like a payment that
 *    never confirms. This cannot hit that.
 *  - This component never sees a payment payload at all, so it CANNOT render a paid state
 *    from anything but what the server just re-read from the API. That property is the
 *    reason the file is shaped this way, and it is the same rule a realtime frame would be
 *    under: a broadcast is a hint to re-fetch, never proof of payment.
 *
 * WHERE THE SOCKET WOULD GO. `@carevelo/realtime` publishes `payment_intent.succeeded` and
 * `payment_intent.failed` on the patient's own channel, and wiring it here would be four
 * lines: subscribe in this effect, and make the callback call `router.refresh()` — the same
 * call the timer makes, because a hint and a tick deserve identical treatment. It is not
 * wired today because the package is not a dependency of this app (apps/patient-portal
 * declares only @carevelo/api-client and @carevelo/ui), and adding it is a lockfile change.
 * Nothing about this screen waits on it: polling is the floor, not the fallback, and the
 * flow completes with the socket absent — which is also its state in production today,
 * where the backend still ships BROADCAST_CONNECTION=log.
 *
 * NO PROGRESS BAR ANYWHERE NEAR THIS. The PRD is explicit that "a fake progress bar that
 * implies imminent success is worse than an honest wait", so this renders null and the
 * words on the screen do the work.
 */

/**
 * The interval, widening with the wait.
 *
 * Five seconds while a PIN is plausibly being typed, because that is where nearly all
 * successful confirmations land. Ten while it is still reasonable. Twenty after two minutes,
 * when the handset has probably not been picked up. Then stop: ten minutes of a patient
 * watching a page is already a long time, the backend goes on reconciling for an hour
 * regardless, and a timer running forever on a phone this product is built for — a
 * mid-range Android on a metered bundle — spends someone else's money to tell them nothing.
 * The Check again button stays on the screen after the timer gives up.
 */
const SCHEDULE = [
  { withinMs: 30_000, everyMs: 5_000 },
  { withinMs: 120_000, everyMs: 10_000 },
  { withinMs: 600_000, everyMs: 20_000 },
] as const

function delayAfter(elapsedMs: number): number | null {
  for (const step of SCHEDULE) {
    if (elapsedMs < step.withinMs) {
      return step.everyMs
    }
  }

  return null
}

export function StatusRefresher({ active }: { active: boolean }) {
  const router = useRouter()
  /*
   * The clock is a ref rather than a local, so the widening schedule survives an effect
   * re-run. If `router`'s identity ever changed on a refresh, a local `startedAt` would
   * reset to zero on every tick and the interval would stay at five seconds for as long as
   * the page was open — a slow leak of somebody's data bundle that nothing would report.
   */
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      return
    }

    startedAt.current ??= Date.now()

    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const schedule = (): void => {
      const delay = delayAfter(Date.now() - (startedAt.current ?? Date.now()))

      if (delay === null || stopped) {
        return
      }

      timer = setTimeout(tick, delay)
    }

    const tick = (): void => {
      if (stopped) {
        return
      }

      // Nothing is spent on a screen nobody is looking at. The visibility listener
      // reconciles the moment it comes back, so a backgrounded tab loses no freshness it
      // could have used.
      if (!document.hidden) {
        router.refresh()
      }

      schedule()
    }

    const onVisibilityChange = (): void => {
      if (!document.hidden && !stopped) {
        router.refresh()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stopped = true

      if (timer !== undefined) {
        clearTimeout(timer)
      }

      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [active, router])

  return null
}
