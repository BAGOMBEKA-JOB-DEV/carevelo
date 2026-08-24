import type { BadgeTone } from '@carevelo/ui'
import type { DeliveryStatus } from '../api/tracking'

/**
 * A delivery's status, as a word and as a colour — in that order of importance.
 *
 * THE WORD IS WHAT THE PATIENT READS. `Badge` in packages/ui requires children for this
 * reason: a coloured pill says nothing to a colour-blind reader and nothing at all to a
 * screen reader, and one of the states here is "could not be delivered".
 *
 * THE WORDS ARE THE PATIENT'S, NOT THE DISPATCH BOARD'S. `en_route` is a state machine's
 * word; "On the way to you" is what somebody waiting for their medicine wants to know.
 * The mapping lives here rather than in a component so the two screens in this domain
 * cannot drift into describing the same status differently.
 *
 * AND NONE OF THEM DESCRIBE THE CONTENTS. There is no field on the tracking resource that
 * could, and no wording here should imply one — not "your antibiotics are on the way", not
 * "3 items". A delivery is a package with a reference on it.
 */

/** The message key under the `Delivery` namespace. A literal union, so `t()` types it. */
export type DeliveryStatusKey =
  | 'status.unassigned'
  | 'status.assigned'
  | 'status.picked_up'
  | 'status.en_route'
  | 'status.delivered'
  | 'status.failed'
  | 'status.returned_to_pharmacy'
  | 'status.unknown'

const WORDS: Record<DeliveryStatus, DeliveryStatusKey> = {
  unassigned: 'status.unassigned',
  assigned: 'status.assigned',
  picked_up: 'status.picked_up',
  en_route: 'status.en_route',
  delivered: 'status.delivered',
  failed: 'status.failed',
  returned_to_pharmacy: 'status.returned_to_pharmacy',
}

/*
 * `returned_to_pharmacy` is WARN rather than BAD: the medicines are safe and back where
 * they started, which is the system working, and painting it red would tell a patient
 * something was lost. `failed` is the one that is genuinely bad, and it is the one that
 * comes with something to do about it.
 */
const TONES: Record<DeliveryStatus, BadgeTone> = {
  unassigned: 'neutral',
  assigned: 'info',
  picked_up: 'info',
  en_route: 'info',
  delivered: 'good',
  failed: 'bad',
  returned_to_pharmacy: 'warn',
}

/**
 * The tracking resource types `status` as a plain string rather than as the enum, so both
 * of these take a string and fall through to an honest "not available" for a value nobody
 * anticipated — rather than asserting a cast and rendering an empty badge.
 */
export function deliveryStatusWord(status: string): DeliveryStatusKey {
  return WORDS[status as DeliveryStatus] ?? 'status.unknown'
}

export function deliveryStatusTone(status: string): BadgeTone {
  return TONES[status as DeliveryStatus] ?? 'neutral'
}
