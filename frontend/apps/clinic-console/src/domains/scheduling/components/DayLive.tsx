'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { dayDigest } from '../api/actions'

/**
 * 'use client' IS EARNED HERE AND NOWHERE ELSE IN THIS DOMAIN.
 *
 * The day view is server-rendered and therefore correct at the moment it is drawn and never
 * again. Noticing that it has changed needs a timer, and a timer needs a browser. That is the
 * entire justification; this component renders one line of text and holds no state a screen
 * depends on.
 *
 * IT DOES NOT RENDER THE SCHEDULE. It asks the server for a short digest — identifiers and
 * states — and when that differs from the one the page was rendered with it calls
 * `router.refresh()` and lets the SERVER render the change. See `dayDigest` for why that
 * distinction is load-bearing rather than fastidious.
 *
 * ==================================================================================
 * WHY THIS IS A BARE INTERVAL AND NOT @carevelo/realtime, WHICH IT SHOULD BE
 * ==================================================================================
 *
 * The wrapper is the sanctioned way to name a channel — it owns channel-name construction
 * precisely so that an unprefixed, therefore cross-tenant, name cannot be built by hand — and
 * the shape below is already the shape it wants:
 *
 *     const live = realtime.live({
 *       channel: realtime.clinicSchedule(),
 *       on: EVENTS_ON['schedule'],
 *       refresh: reconcile,          // this file's `reconcile`, unchanged
 *     })
 *
 * Two things stop that being written today and neither is a preference.
 *
 *   1. `@carevelo/realtime` IS NOT A DEPENDENCY OF THIS APP. No app declares it, so there is
 *      no link in node_modules, the import does not resolve, and both `pnpm typecheck` and
 *      the boundary check's `no-unresolvable` rule fail. Adding it is a package.json edit and
 *      an install, and an install is a lockfile change this work was explicitly forbidden
 *      from making while other changes hold the same lockfile.
 *   2. Nothing broadcasts a schedule event yet, so `live()` would be a timer at the same
 *      cadence as this one — which makes the eventual swap behaviour-preserving rather than a
 *      rewrite.
 *
 * POLLING IS THE FLOOR, NOT THE FALLBACK. Get that the wrong way round and you write a screen
 * waiting for a frame that never arrives. Nothing on this page blocks on the socket, because
 * there is nothing here that a full server render does not already do.
 *
 * IT COSTS NOTHING WHEN IT IS ABSENT. Everything it keeps fresh is already on the page,
 * server-rendered, and every navigation on this screen is a plain document load. A console
 * whose JavaScript never arrived loses freshness and no function at all.
 *
 * @see packages/realtime/README.md
 */

/** Matches @carevelo/realtime's own `pollEveryMs` default, so adopting it changes nothing. */
const POLL_MS = 15_000

export function DayLive({
  day,
  clinicianId,
  signature,
}: {
  day: string
  clinicianId: string | null
  /** The digest the server rendered this page with. */
  signature: string
}) {
  const router = useRouter()
  const seen = useRef(signature)

  // Keeps the ref in step with what the server last rendered, so a refresh triggered from
  // anywhere else — a colleague's navigation, the clinician's own reload — does not leave this
  // component convinced the page is stale and refreshing it for ever.
  useEffect(() => {
    seen.current = signature
  }, [signature])

  const reconcile = useCallback(async () => {
    const next = await dayDigest(day, clinicianId)

    // 'unknown' is what a failed poll returns. Treating it as a change would refresh the page
    // on every tick of a broken connection, which is the one thing worse than being stale.
    if (next !== 'unknown' && next !== seen.current) {
      seen.current = next
      router.refresh()
    }
  }, [day, clinicianId, router])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

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

    // STOPS WHILE THE TAB IS HIDDEN and reconciles the moment it comes back. A clinician's
    // handset battery and data bundle are not ours to spend on a screen nobody is looking at,
    // and a console left open in a consulting room all day is the ordinary case.
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
  }, [reconcile])

  return (
    <p className="fine">
      This day refreshes itself about every fifteen seconds. Reload if you need to be certain.
    </p>
  )
}
