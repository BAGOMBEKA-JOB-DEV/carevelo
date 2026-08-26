import { Badge } from '@carevelo/ui'
import { STANDING_LABEL, STANDING_TONE, type Standing } from '../model/subscription'

/**
 * How a clinic's paid-through date reads today, as a word first and a colour second.
 *
 * THE COLOUR IS NEVER THE ONLY SIGNAL, like every other badge on this surface: a coloured
 * pill says nothing to a colour-blind operator and less to a screen reader, so the tone is
 * a second opinion on a fact the text already states.
 *
 * `past_due` IS AMBER AND NOT RED. Red is this system's colour for a failed or forbidden
 * state, and a clinic whose period has ended is neither — it may be four days into a
 * seven-day grace window with a Pesapal retry in flight, and its staff are still signing in
 * normally. Painting an ordinary billing cycle as a failure is how an operator comes to
 * treat a late payment as an incident, which is the exact confusion the suspension design
 * exists to prevent. What HAS happened to the clinic is its lifecycle state, which the
 * register shows in the column beside this one.
 *
 * THERE IS NO UNKNOWN CASE HERE, and that is a real difference from `StatusBadge`. `Standing`
 * is computed in this app by `standingOf()` rather than read off the wire, so the set is
 * closed by construction and a fallback would be dead code pretending to be caution.
 */
export function StandingBadge({ standing }: { standing: Standing }) {
  return <Badge tone={STANDING_TONE[standing]}>{STANDING_LABEL[standing]}</Badge>
}
