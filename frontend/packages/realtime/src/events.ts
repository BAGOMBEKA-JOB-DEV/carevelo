/**
 * The event catalogue, and the one type this package exists to hand out: a Hint.
 *
 * ===================================================================================
 * A FRAME IS A HINT TO RE-FETCH. IT IS NEVER THE THING ITSELF.
 * ===================================================================================
 *
 * This is rule 4, and it is the rule most likely to be broken by a well-meaning
 * feature — so it is enforced here by the shape of the type rather than by a note in a
 * README that a deadline will win an argument with.
 *
 * The backend puts three or four fields on the wire: an identifier, a `reference`, a
 * `status`, sometimes an operational `failure_reason`. THIS PACKAGE DISCARDS ALL BUT
 * THE IDENTIFIER, and the discarding is the point. A Hint says *which record changed*
 * and nothing about *what it now says*, because the moment a screen can read `status`
 * off a frame it will render it, and at that instant four things stop being true:
 *
 *   - The API is no longer the single source of truth. Frames drop, duplicate and
 *     replay; a dropped frame is supposed to degrade freshness, never correctness.
 *   - Authorisation stops being enforced on the re-fetch. The channel decides WHO IS
 *     TOLD something changed; the API decides WHAT THEY MAY SEE, under abilities,
 *     policies and row-level security. A view rendered from a payload has skipped the
 *     half that checks.
 *   - Payment state becomes a claim the client made. A client must never treat
 *     `payment_intent.succeeded` as proof a patient paid — the intent's state is read
 *     back from the API, which reconciles independently of any webhook.
 *   - The payload rule stops being cheap to hold. It is affordable today precisely
 *     because nothing downstream needs the payload; the first screen that renders from
 *     one creates the pressure to put one more field on the wire, and the field after
 *     that is a medicine name.
 *
 * So: `hint.id` is an argument to an authorised GET, not data. `hint.id === null` means
 * "something changed but not a record you can fetch on its own" — reconcile the whole
 * view.
 *
 * @see docs/30-architecture/realtime-broadcasting.md — the payload rule and rule 4
 * @see backend/app/Events/TenantBroadcast.php — the same rule, enforced by construction
 */

import type { ChannelKind } from './channels'

/**
 * Every `broadcastAs()` name in backend/app/Events.
 *
 * Nine events, and the names are the ubiquitous language rather than PHP class names —
 * `SubstitutionApproved` broadcasts as `substitution.decided` because the same event
 * serves an approval and a rejection, and its `status` (which never leaves this package)
 * carries which.
 */
export type RealtimeEvent =
  | 'prescription.issued'
  | 'order.dispensed'
  | 'substitution.proposed'
  | 'substitution.decided'
  | 'delivery.assigned'
  | 'delivery.delivered'
  | 'delivery.failed'
  | 'payment_intent.succeeded'
  | 'payment_intent.failed'

/** What kind of record a hint points at, in the API's own vocabulary. */
export type HintSubject = 'dispense_order' | 'substitution' | 'delivery' | 'payment_intent'

/**
 * Something changed. Go and ask the API what it is now.
 *
 * Three fields, and none of them is content. There is no `status` here and there never
 * will be; see the header of this file.
 */
export interface Hint {
  /** Which broadcast arrived. Useful for deciding WHICH endpoint to re-fetch. */
  readonly event: RealtimeEvent
  /** What kind of record it concerns. */
  readonly subject: HintSubject
  /**
   * The identifier to re-fetch, or null when the frame names no fetchable record.
   *
   * Null is not an error and must not be treated as one: `prescription.issued` carries
   * no dispense order when the prescription was issued for collection elsewhere, which
   * is a supported case — the clinic's pharmacy is a choice, never a requirement.
   * Reconcile the view instead.
   */
  readonly id: string | null
}

interface EventDescriptor {
  readonly subject: HintSubject
  /** The single payload key this package reads. Everything else on the frame is dropped. */
  readonly idKey: string
}

/**
 * Which identifier to lift out of each frame, and what it points at.
 *
 * Note `prescription.issued` reads `dispense_order_id` and not `prescription_id`: the
 * pharmacy queue is a list of dispense orders, and a prescription that produced none is
 * not in it. That frame therefore arrives with `id: null`, which is honest — there is
 * nothing for that screen to fetch.
 */
const EVENT_CATALOGUE: { readonly [E in RealtimeEvent]: EventDescriptor } = {
  'prescription.issued': { subject: 'dispense_order', idKey: 'dispense_order_id' },
  'order.dispensed': { subject: 'dispense_order', idKey: 'order_id' },
  'substitution.proposed': { subject: 'substitution', idKey: 'substitution_id' },
  'substitution.decided': { subject: 'substitution', idKey: 'substitution_id' },
  'delivery.assigned': { subject: 'delivery', idKey: 'delivery_id' },
  'delivery.delivered': { subject: 'delivery', idKey: 'delivery_id' },
  'delivery.failed': { subject: 'delivery', idKey: 'delivery_id' },
  'payment_intent.succeeded': { subject: 'payment_intent', idKey: 'payment_intent_id' },
  'payment_intent.failed': { subject: 'payment_intent', idKey: 'payment_intent_id' },
}

/**
 * Which events actually reach which channel.
 *
 * Taken from `broadcastOn()` in backend/app/Events, so it is the routing the backend
 * performs rather than a guess. It is a TYPE and not only a list because listening on a
 * channel for an event that channel never carries is a silent no-op — a screen that
 * waits forever for a frame and looks, from the outside, exactly like a broken socket.
 * Here it is a compile error.
 *
 * `consultation` is `never`, deliberately and temporarily: the channel is authorised
 * server-side (ConsultationChannel) but no event in backend/app/Events broadcasts to it
 * yet. When ConsultationStarted exists, add it to RealtimeEvent, to EVENT_CATALOGUE and
 * to this map — and the compiler will then let a screen listen for it, and not before.
 */
export interface ChannelEvents {
  'pharmacy-queue': 'prescription.issued' | 'order.dispensed' | 'substitution.decided'
  'dispatch-board': 'delivery.assigned' | 'delivery.delivered' | 'delivery.failed'
  user: 'substitution.proposed' | 'payment_intent.succeeded' | 'payment_intent.failed'
  patient:
    | 'order.dispensed'
    | 'delivery.delivered'
    | 'delivery.failed'
    | 'payment_intent.succeeded'
    | 'payment_intent.failed'
  rider: 'delivery.assigned'
  consultation: never
}

/** The events a given channel can deliver. */
export type ChannelEvent<K extends ChannelKind> = ChannelEvents[K]

/**
 * Everything a channel carries, for the common case of "keep this view fresh".
 *
 * A screen that wants every change on its channel writes `on: EVENTS_ON['pharmacy-queue']`
 * rather than retyping the list and getting it subtly wrong.
 */
export const EVENTS_ON = {
  'pharmacy-queue': ['prescription.issued', 'order.dispensed', 'substitution.decided'],
  'dispatch-board': ['delivery.assigned', 'delivery.delivered', 'delivery.failed'],
  user: ['substitution.proposed', 'payment_intent.succeeded', 'payment_intent.failed'],
  patient: [
    'order.dispensed',
    'delivery.delivered',
    'delivery.failed',
    'payment_intent.succeeded',
    'payment_intent.failed',
  ],
  rider: ['delivery.assigned'],
  consultation: [],
} as const satisfies { readonly [K in ChannelKind]: readonly ChannelEvent<K>[] }

/**
 * Turn a frame into a hint, keeping one identifier and dropping the rest of the wire.
 *
 * Everything the socket delivers passes through here, which is what makes the promise
 * at the top of this file structural rather than aspirational: `payload` is `unknown`,
 * it is read one key at a time, and the object it came from is never returned.
 */
export function hintFrom(event: RealtimeEvent, payload: unknown): Hint {
  const descriptor = EVENT_CATALOGUE[event]

  return { event, subject: descriptor.subject, id: readIdentifier(payload, descriptor.idKey) }
}

/**
 * Read one identifier-shaped value as a string.
 *
 * Anything else — a number, an object, a missing key, an empty string — becomes null and
 * therefore a full reconcile. A frame is untrusted input like any other; it arrives over
 * a socket that has been open for hours and may have been restarted at the other end
 * since the code that built it was deployed.
 */
function readIdentifier(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const value = (payload as Record<string, unknown>)[key]

  return typeof value === 'string' && value !== '' ? value : null
}
