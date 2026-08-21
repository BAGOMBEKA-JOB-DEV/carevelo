'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { checkRoom } from '../api/actions'

/**
 * The one client component in this domain, and the only one that earns the directive.
 *
 * WHAT IT IS FOR. The room is server-rendered and therefore correct at the moment it is
 * drawn and never again: the clinician joins, steps the consultation down to voice, or ends
 * it, and a patient staring at a page from four minutes ago has no way to know. That is the
 * frozen frame the whole degradation design exists to prevent, arriving by a different
 * road. So something has to notice, and noticing needs a timer, and a timer needs a browser.
 *
 * WHAT IT DELIBERATELY IS NOT. It does not render the consultation. It asks the server for
 * a short signature — identifier, mode, outcome, ended-at — and when that differs from the
 * one the page was rendered with, it calls `router.refresh()` and lets the SERVER render
 * the change. That is @carevelo/realtime's central rule applied to a poll: "a frame is a
 * hint to re-fetch, it is never the thing itself." Three things follow, and each is worth
 * the extra round trip:
 *
 *   - the API stays the single source of truth, so a missed tick costs freshness and never
 *     correctness;
 *   - the re-render runs the whole authorisation again, under the policy and row-level
 *     security, rather than trusting a value this component already held;
 *   - nothing clinical is ever handed to the browser except by a server render that was
 *     going to hand it over anyway.
 *
 * ==================================================================================
 * WHY THIS IS A BARE INTERVAL AND NOT @carevelo/realtime, WHICH IT SHOULD BE
 * ==================================================================================
 *
 * `private-tenant.{id}.consultation.{id}` is the right home for this. It is authorised
 * server-side by ConsultationChannel, it carries SESSION STATE and never media or clinical
 * content, and @carevelo/realtime is the only sanctioned way to name it — the wrapper owns
 * channel-name construction precisely so that a cross-tenant name cannot be built by hand.
 * The shape below is already the shape that package wants:
 *
 *     const live = realtime.live({
 *       channel: realtime.consultation(consultationId),
 *       on: EVENTS_ON.consultation,     // [] today; see the package's Known gaps
 *       refresh: reconcile,             // this file's `reconcile`, unchanged
 *     })
 *
 * Two things stop that being written today, and neither is a preference.
 *
 *   1. NOTHING BROADCASTS TO THAT CHANNEL. No event in backend/app/Events names it, so
 *      `ChannelEvents['consultation']` is `never` and `EVENTS_ON.consultation` is the empty
 *      list. With `BROADCAST_CONNECTION=log` and no Reverb configured, `live()` would be a
 *      timer — which is exactly what is below, at the same cadence, so the swap is
 *      behaviour-preserving on the day it happens.
 *   2. `@carevelo/realtime` IS NOT A DEPENDENCY OF THIS APP. No app declares it, so there
 *      is no link in node_modules and the import does not resolve — which fails typecheck
 *      and the boundary check's `no-unresolvable` rule. Adding it is a package.json edit
 *      plus an install, and an install is a lockfile change that this work was explicitly
 *      forbidden from making while other agents hold the same lockfile. Written down here
 *      rather than papered over with a bare `laravel-echo` import, which the lint rules
 *      would refuse anyway and rightly.
 *
 * Polling is the FLOOR here, not the fallback. Get that the wrong way round and you write a
 * screen waiting for a frame that never comes.
 *
 * IT COSTS NOTHING WHEN IT IS ABSENT. Everything this keeps fresh is already on the page,
 * server-rendered, and the room carries a plain "check now" link that is an ordinary
 * navigation. A patient whose JavaScript never arrives loses freshness and no function at
 * all, which is the rule the whole portal is built to.
 *
 * @see packages/realtime/README.md — "Polling is not the fallback. It is the floor."
 * @see packages/realtime/src/events.ts — why `consultation` is `never`
 */

/**
 * Matches @carevelo/realtime's own `pollEveryMs` default, so adopting the wrapper changes
 * the mechanism and not the behaviour.
 */
const POLL_MS = 15_000

export function RoomLive({
  appointmentId,
  signature,
  hasEnded,
  label,
}: {
  appointmentId: string
  /** The signature the server rendered this page with. */
  signature: string
  /** An ended consultation cannot change again, so nothing is spent watching one. */
  hasEnded: boolean
  /** Translated on the server: a client component cannot read the catalogue cheaply. */
  label: string
}) {
  const router = useRouter()
  const seen = useRef(signature)

  // Keeps the ref in step with what the server last rendered, so a refresh triggered from
  // anywhere else — the patient's own reload, a navigation — does not leave this component
  // convinced the page is stale and refreshing it for ever.
  useEffect(() => {
    seen.current = signature
  }, [signature])

  const reconcile = useCallback(async () => {
    // Exactly the signature `live({ refresh })` expects: no argument used, no return value
    // rendered. A screen that ignores the hint and re-reconciles is correct, merely heavier.
    const next = await checkRoom(appointmentId)

    if (next !== seen.current) {
      seen.current = next
      router.refresh()
    }
  }, [appointmentId, router])

  useEffect(() => {
    if (hasEnded) {
      return
    }

    let timer: ReturnType<typeof setInterval> | null = null

    // STOPS WHILE THE TAB IS HIDDEN, and reconciles the moment it comes back. The wrapper
    // does the same, for the same reason: a patient's data bundle and a mid-range phone's
    // battery are not ours to spend on a screen nobody is looking at — and this screen is
    // opened by people who are ill, on metered mobile data, often for a long wait.
    const start = () => {
      if (timer === null) {
        timer = setInterval(() => void reconcile(), POLL_MS)
      }
    }

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop()

        return
      }

      void reconcile()
      start()
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)

    // Not optional. Without it a remounting screen accumulates timers and listeners.
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reconcile, hasEnded])

  if (hasEnded) {
    return null
  }

  return <p className="fine">{label}</p>
}
