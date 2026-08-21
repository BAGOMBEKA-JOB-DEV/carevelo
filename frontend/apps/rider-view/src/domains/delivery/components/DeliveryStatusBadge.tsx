import { Badge, type BadgeTone } from '@carevelo/ui'
import { view } from '../model/status'
import type { DeliveryStatus } from '../model/types'

/**
 * Where a delivery has got to, as a word.
 *
 * A WORD, NOT A COLOUR. A coloured dot alone is unreadable to a colour-blind rider and
 * silent to a screen reader, and this is a surface used in bright sunlight on a phone held
 * at arm's length. The tone below is a second signal for people who can use it, never the
 * first one.
 *
 * THE TONE TABLE IS SEPARATE FROM `model/status.ts` ON PURPOSE. That module is about what
 * the state machine permits and must stay free of anything to do with rendering — it is
 * the file a reader goes to in order to answer "may a rider do this", and a `BadgeTone`
 * sitting in it would make it a presentation file. Keyed by the generated union, so it is
 * exhaustive by construction: an eighth status stops this compiling.
 */
const TONE: Record<DeliveryStatus, BadgeTone> = {
  // Nothing has happened yet, and nothing is wrong.
  unassigned: 'neutral',
  assigned: 'info',
  picked_up: 'info',
  // Deliberately not 'warn'. A delivery on the way is the normal, healthy state of this
  // app — warning colour on the most common status trains the eye to ignore the colour.
  en_route: 'info',
  delivered: 'good',
  failed: 'bad',
  returned_to_pharmacy: 'neutral',
}

export function DeliveryStatusBadge({ status }: { status: string }) {
  const tone = TONE[status as DeliveryStatus] ?? 'neutral'

  return <Badge tone={tone}>{view(status).label}</Badge>
}
