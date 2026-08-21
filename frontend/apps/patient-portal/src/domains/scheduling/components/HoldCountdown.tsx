'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@carevelo/ui'

/**
 * THE ONLY 'use client' IN THIS DOMAIN, and here is the whole justification.
 *
 * A prepaid booking holds its slot for fifteen minutes and then
 * `appointments:release-unpaid` takes it back. The patient has to be told how long is
 * left, and "how long is left" is the one fact on this surface that cannot be
 * server-rendered: it changes while the page sits open, and a server-rendered "9 minutes
 * left" that was true when the HTML was built is a lie thirty seconds later. The
 * requirement is not decoration — most mobile-money prompts are never completed, so
 * arriving back at an expired booking is the common case, and a patient who believed they
 * had longer is a patient who has to start again without knowing why.
 *
 * WHAT IT DOES NOT COST. The absolute deadline is rendered on the SERVER, in the sentence
 * above this badge: "Held until 14:32." Everything a patient needs is already in the HTML
 * with no JavaScript at all. This component only adds the ticking remainder on top, and
 * it renders NOTHING until it has mounted — so the first client render is identical to
 * the server's, there is no hydration mismatch, and a patient whose bundle never arrives
 * is not missing information, only convenience.
 *
 * WHY THE WORDS COME IN AS PROPS. A client component cannot read the message catalogue
 * without `NextIntlClientProvider`, which serialises part of the catalogue into the RSC
 * payload and pulls the formatting runtime into a bundle with 150KB to spend. So the
 * server formats every sentence this can display — sixteen of them, one per whole minute,
 * each a proper ICU plural — and hands down strings. This is the same trade `SiteShell`
 * makes for the header, for the same reason.
 *
 * WHY IT IS NOT A LIVE REGION. A value that changes every few seconds inside
 * `aria-live` interrupts a screen reader continuously and buries whatever it was reading.
 * The deadline sentence beside it is the accessible statement of the same fact, rendered
 * once, in the page, where a reader meets it in reading order.
 */

export type HoldCountdownProps = {
  /** An ISO-8601 instant. Derived from `created_at` — see model/hold.ts. */
  expiresAt: string
  /**
   * Indexed by WHOLE MINUTES remaining: `labels[0]` is the under-a-minute sentence,
   * `labels[9]` is "9 minutes left". Built on the server so plurals are real plurals.
   */
  labels: readonly string[]
  /** What to say once the hold has gone. */
  ended: string
}

/** Ten seconds. A countdown shown in minutes needs no finer tick, and this one runs on a
    phone whose battery the patient may need later in the day. */
const TICK_MS = 10_000

const MS_PER_MINUTE = 60_000

export function HoldCountdown({ expiresAt, labels, ended }: HoldCountdownProps) {
  // `null` until mounted, which is what makes the first client render match the server's
  // empty one. Deliberately not `Date.now()` in the initialiser: that runs during
  // hydration and would differ from the server's markup.
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    const deadline = Date.parse(expiresAt)

    if (Number.isNaN(deadline)) {
      return
    }

    const tick = () => setRemaining(Math.max(0, deadline - Date.now()))

    tick()
    const timer = window.setInterval(tick, TICK_MS)

    return () => window.clearInterval(timer)
  }, [expiresAt])

  if (remaining === null) {
    return null
  }

  if (remaining <= 0) {
    return (
      <Badge tone="bad" icon="clock">
        {ended}
      </Badge>
    )
  }

  // Rounded DOWN, so the number never promises more time than there is. A patient told
  // "5 minutes left" with 5:59 remaining has been under-promised; told it with 5:01 they
  // would have been over-promised, which is the failure that costs them the slot.
  const minutes = Math.min(labels.length - 1, Math.floor(remaining / MS_PER_MINUTE))

  return (
    <Badge tone="warn" icon="clock">
      {labels[minutes] ?? ended}
    </Badge>
  )
}
