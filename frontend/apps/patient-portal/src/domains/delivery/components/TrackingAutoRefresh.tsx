'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The only client component in either of these domains, and it renders nothing.
 *
 * WHY IT EARNS THE DIRECTIVE. Everything else here is a document: a prescription, a
 * choice, a list of milestones. This is the one thing that is genuinely about time
 * passing — a patient with the tracking page open wants the next step to appear without
 * being told to reload — and there is no way to run a timer on the server. It ships a
 * timer, a visibility listener and `router.refresh()`, and no markup at all.
 *
 * POLLING IS NOT THE FALLBACK, IT IS THE FLOOR. `packages/realtime` puts it plainly, and
 * it is doubly true here: the patient portal does not depend on `@carevelo/realtime` at
 * all today, and `BROADCAST_CONNECTION=log` means nothing reaches a socket anyway. When
 * the socket does arrive, the frames on the patient's own channel — `delivery.delivered`,
 * `delivery.failed` — are HINTS TO RE-FETCH and never the thing itself, so what they will
 * do is call exactly this refresh sooner. Nothing on the screen will render from a frame.
 *
 * `router.refresh()` RATHER THAN `location.reload()`. It re-runs the server render and
 * merges the result, so scroll position, focus and any expanded detail survive. A patient
 * reading the failure notice is not thrown back to the top of the page every twenty
 * seconds — which would be both hostile and a WCAG problem, since a page that reloads
 * under a screen reader loses the reader's place.
 *
 * IT STOPS WHEN THE TAB IS HIDDEN. A patient's data bundle is not ours to spend on a page
 * nobody is looking at, and this one is most likely to be left open in a background tab
 * for an hour. Coming back to the tab reconciles immediately, so the first thing they see
 * is current rather than an hour old.
 *
 * THE PAGE MOUNTS THIS ONLY WHILE THE DELIVERY IS STILL MOVING. A delivered or failed
 * delivery is not going to change, and polling it is spending somebody's money on an
 * answer that cannot differ.
 */
export function TrackingAutoRefresh({ everyMs = 20_000 }: { everyMs?: number | undefined }) {
  const router = useRouter()

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    const start = (): void => {
      if (timer === undefined) {
        timer = setInterval(() => router.refresh(), everyMs)
      }
    }

    const stop = (): void => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        // Reconcile first, then resume: whatever happened while the tab was hidden should
        // be on screen before the next tick, not twenty seconds after it.
        router.refresh()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') {
      start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    // Clearing on unmount is not optional. Without it a remounting screen accumulates
    // timers, and each one keeps calling the API after its page has gone.
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [router, everyMs])

  return null
}
