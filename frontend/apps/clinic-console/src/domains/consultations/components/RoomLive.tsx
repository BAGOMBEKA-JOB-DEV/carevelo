'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { roomDigest } from '../api/actions'

/**
 * Noticing that the encounter moved underneath a page that was rendered four minutes ago.
 *
 * The room is server-rendered and therefore correct once. The patient joins; a colleague adds
 * an addendum; the clinician's own second tab ends the consultation. None of that reaches a
 * drawn page, and the failure is silent — which is the frozen frame the whole degradation
 * design exists to prevent, arriving by a different road.
 *
 * IT DOES NOT RENDER THE ENCOUNTER. It asks the server for a short digest and, when that
 * differs, calls `router.refresh()` so the SERVER renders the change under the same
 * authorisation as the first render. See `roomDigest` — that distinction is the rule
 * @carevelo/realtime exists to enforce, applied to a poll.
 *
 * ==================================================================================
 * WHY THIS IS A BARE INTERVAL AND NOT @carevelo/realtime
 * ==================================================================================
 *
 * `private-tenant.{id}.consultation.{id}` is the right home for this: it is authorised
 * server-side by `ConsultationChannel`, it carries session state and never media or clinical
 * content, and the wrapper is the only sanctioned way to name it. Two things stop it today.
 *
 *   1. `@carevelo/realtime` IS NOT A DEPENDENCY OF THIS APP. No app declares it, so the import
 *      does not resolve — which fails typecheck and the boundary check's `no-unresolvable`
 *      rule. Adding it is a lockfile change this work was explicitly forbidden from making.
 *   2. Nothing broadcasts to that channel yet, so `live()` would be a timer at this same
 *      cadence — which makes the eventual swap behaviour-preserving rather than a rewrite.
 *
 * POLLING IS THE FLOOR, NOT THE FALLBACK. Nothing in this room blocks on it: every fact on the
 * screen is server-rendered, and the note editor's safety net is local storage, not this.
 *
 * IT STOPS WHEN THE ENCOUNTER IS OVER. An ended consultation cannot change again, so nothing
 * is spent watching one — that matters on a handset in a clinic with a metered connection.
 */

/** Matches @carevelo/realtime's own `pollEveryMs` default, so adopting it changes nothing. */
const POLL_MS = 15_000

export function RoomLive({
  appointmentId,
  patientId,
  signature,
  hasEnded,
}: {
  appointmentId: string
  patientId: string
  /** The digest the server rendered this page with. */
  signature: string
  hasEnded: boolean
}) {
  const router = useRouter()
  const seen = useRef(signature)

  useEffect(() => {
    seen.current = signature
  }, [signature])

  const reconcile = useCallback(async () => {
    const next = await roomDigest(appointmentId, patientId)

    if (next !== seen.current) {
      seen.current = next
      router.refresh()
    }
  }, [appointmentId, patientId, router])

  useEffect(() => {
    if (hasEnded) {
      return
    }

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

    /*
     * PAUSED WHILE THE TAB IS HIDDEN. A refresh while the clinician is in another tab would
     * also re-render the note editor and could interrupt typing when they come back; the room
     * reconciles once on return instead.
     */
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

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reconcile, hasEnded])

  if (hasEnded) {
    return null
  }

  return (
    <p className="fine">
      This page checks the clinic&rsquo;s record about every fifteen seconds. Your note is kept
      on this device as you type and does not depend on it.
    </p>
  )
}
