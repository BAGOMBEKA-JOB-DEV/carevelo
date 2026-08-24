import type { components, operations } from '@carevelo/api-client'

/**
 * The shapes this domain reads, taken from the generated contract wherever the generator
 * managed to describe them — and narrowed at runtime in the two places it did not.
 *
 * ------------------------------------------------------------------
 * WHERE THE CONTRACT IS LOSSY, AND WHY THE PARSERS ARE NOT HAND-WRITTEN API TYPES
 *
 * The house rule is absolute: never hand-write an API type, because a hand-written type is a
 * second copy of the contract that drifts silently. Two of the three endpoints here make
 * that impossible to obey literally, and saying so is better than pretending otherwise.
 *
 *   `GET /v1/notification-templates` is generated as `data: unknown[]`. The controller builds
 *   each entry with an `array_map` returning a plain PHP array, which the generator cannot
 *   see into.
 *
 *   `GET /v1/sms-balance` is generated with `data.sms: string`. It is not a string — it is an
 *   object of counts keyed by status plus a total, assembled as `$counts + ['total' => …]`,
 *   and the generator lost it for the same reason.
 *
 * So every field the contract DOES describe is used from the contract, and the fields it lost
 * are read by a parser that checks each one and reports what it could not read. That is the
 * material difference from a hand-written type: a hand-written `{ total: number }` drifts
 * into a lie the compiler will defend, whereas a value the API stops sending in this shape
 * stops appearing and says so.
 *
 * @see packages/api-client/src/generated/schema.d.ts — generated from docs/40-api/openapi.yaml
 * @see backend/app/Http/Controllers/Api/V1/NotificationController.php
 */

/** One message the clinic sent, or tried to. The recipient arrives already masked. */
export type OutboundNotification = components['schemas']['OutboundNotificationResource']

/**
 * The lifecycle of one outbound message.
 *
 * `sent` MEANS THE GATEWAY ACCEPTED IT, WHICH IS NOT THE SAME AS THE HANDSET RECEIVING IT.
 * That is `delivered`, and only where the gateway reports receipts at all. The distinction
 * is the entire reason this screen exists — it is what an administrator needs when a patient
 * says they were never told — so nothing in this domain may collapse the two.
 */
export type NotificationStatus = components['schemas']['NotificationStatus']

/**
 * The channels a message may leave on. BOTH ARE UNTRUSTED TRANSPORTS: SMS transits the
 * mobile operator and lands on a lock screen; WhatsApp Business API is hosted outside Uganda
 * and is therefore a cross-border transfer as well. Neither may ever carry clinical content,
 * which is why the template catalogue is closed and read-only.
 */
export type NotificationChannel = components['schemas']['NotificationChannel']

type IndexQuery = NonNullable<operations['v1.notifications.index']['parameters']['query']>

/**
 * The catalogue keys, straight off the request contract.
 *
 * A CLOSED LIST, WHICH IS WHY THE FILTER IS A SELECT AND NOT A TEXT BOX. The API rejects an
 * unknown key rather than returning an empty result set to puzzle over, so offering free
 * text would be offering a way to produce a validation error.
 */
export type TemplateKey = NonNullable<IndexQuery['template_key']>

export type NotificationFilters = {
  status?: NotificationStatus | undefined
  channel?: NotificationChannel | undefined
  templateKey?: TemplateKey | undefined
  cursor?: string | undefined
}

type IndexResponse =
  operations['v1.notifications.index']['responses'][200]['content']['application/json']

/**
 * One page of send history.
 *
 * CURSOR, NEVER OFFSET. The clinic is sending messages while an administrator pages through
 * this, and that is precisely the traffic under which an offset duplicates and skips rows. A
 * skipped row here is a message somebody concludes was never sent.
 */
export type NotificationPage = {
  readonly notifications: readonly OutboundNotification[]
  readonly nextCursor: string | null
  readonly prevCursor: string | null
}

export function notificationPageFrom(response: IndexResponse): NotificationPage {
  return {
    notifications: response.data,
    nextCursor: response.meta.next_cursor,
    prevCursor: response.meta.prev_cursor,
  }
}

/**
 * One template in the catalogue.
 *
 * Narrowed from `unknown` for the reason in the header. `key` and `body` are the two that
 * must be present for an entry to be worth showing: the catalogue exists so a clinic can
 * read exactly what is sent under its own sender ID, and an entry missing either of those
 * cannot serve that purpose.
 */
export type NotificationTemplate = {
  readonly key: string
  readonly body: string
  readonly placeholders: readonly string[]
  readonly channels: readonly string[]
  /** A permanent failure on one of these is surfaced to staff rather than swallowed. */
  readonly isCritical: boolean
  readonly permitsLink: boolean
}

function stringsIn(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function templateFrom(value: unknown): NotificationTemplate | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const source = value as Record<string, unknown>

  if (typeof source['key'] !== 'string' || typeof source['body'] !== 'string') {
    return null
  }

  return {
    key: source['key'],
    body: source['body'],
    placeholders: stringsIn(source['placeholders']),
    channels: stringsIn(source['channels']),
    isCritical: source['is_critical'] === true,
    permitsLink: source['permits_link'] === true,
  }
}

/**
 * How much SMS this clinic has used this month.
 *
 * NOT A CREDIT, NOT A FIGURE HELD ON ANYONE'S BEHALF, AND THE UI MUST NEVER CALL IT ONE.
 * SMS is a metered pass-through invoiced by the gateway; the platform holds nothing to draw
 * down and keeps no ledger, so the only honest report is what it can count — the messages
 * recorded for this clinic, and how many the per-tenant rate limit suppressed. The endpoint
 * is named `/v1/sms-balance` and that name is the contract's, not this product's vocabulary;
 * every label rendered from this type says "used" or "sent".
 *
 * `suppressed` IS THE OPERATIONALLY IMPORTANT NUMBER. A clinic watching it rise is a clinic
 * whose reminders are silently not arriving, and nobody will notice from the sent counts.
 */
export type SmsUsage = {
  readonly periodStart: string | null
  /** Counts keyed by status, exactly as the API assembled them. Order is not meaningful. */
  readonly counts: readonly { readonly status: string; readonly count: number }[]
  readonly total: number | null
  readonly perMinuteLimit: number | null
  readonly suppressed: number | null
  /** The API's own caveat. Rendered verbatim — it is the one that says no credit is held. */
  readonly note: string
  /**
   * True when the counts could not be read in the expected shape.
   *
   * SURFACED RATHER THAN SHOWN AS ZERO. "0 messages sent" and "we could not read the
   * figures" lead a clinic to do opposite things, and a zero is the more alarming of the two
   * to be wrong about.
   */
  readonly unreadable: boolean
}

type UsagePayload = {
  data?: { period_start?: unknown; sms?: unknown; rate_limit?: unknown }
  meta?: { note?: unknown }
}

export function smsUsageFrom(payload: UsagePayload): SmsUsage {
  const sms = payload.data?.sms
  const readable = typeof sms === 'object' && sms !== null
  const entries = readable ? Object.entries(sms as Record<string, unknown>) : []
  const rateLimit = payload.data?.rate_limit

  const counts = entries
    .filter(([status, count]) => status !== 'total' && typeof count === 'number')
    .map(([status, count]) => ({ status, count: count as number }))

  const total = entries.find(([status]) => status === 'total')?.[1]

  return {
    periodStart: typeof payload.data?.period_start === 'string' ? payload.data.period_start : null,
    counts,
    total: typeof total === 'number' ? total : null,
    perMinuteLimit: numberOn(rateLimit, 'per_minute'),
    suppressed: numberOn(rateLimit, 'suppressed_this_period'),
    note: typeof payload.meta?.note === 'string' ? payload.meta.note : '',
    unreadable: !readable,
  }
}

function numberOn(source: unknown, key: string): number | null {
  if (typeof source !== 'object' || source === null) {
    return null
  }

  const value = (source as Record<string, unknown>)[key]

  return typeof value === 'number' ? value : null
}

/**
 * The filter catalogues the screen renders from.
 *
 * DISPLAY LABELS, NOT WIRE TYPES — but the KEYS are the contract's, so a value the API stops
 * accepting stops compiling here rather than turning into a 422 somebody has to reproduce.
 */
export const STATUS_LABELS = {
  queued: 'Queued',
  sent: 'Sent to the gateway',
  delivered: 'Delivered to the handset',
  failed: 'Failed',
} as const satisfies Record<NotificationStatus, string>

export const CHANNEL_LABELS = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
} as const satisfies Record<NotificationChannel, string>

export const TEMPLATE_LABELS = {
  'appointment.confirmed': 'Appointment confirmed',
  'appointment.reminder': 'Appointment reminder',
  'appointment.cancelled': 'Appointment cancelled',
  'payment.succeeded': 'Payment received',
  'payment.failed': 'Payment failed',
  'prescription.ready': 'Prescription ready',
  'order.priced': 'Order priced',
  'order.ready_for_pickup': 'Ready for pickup',
  'delivery.on_its_way': 'Delivery on its way',
  'delivery.completed': 'Delivery completed',
  'results.available': 'Results available',
  'staff.invitation': 'Staff invitation',
} as const satisfies Record<TemplateKey, string>

export function templateLabel(key: string): string {
  return key in TEMPLATE_LABELS ? TEMPLATE_LABELS[key as TemplateKey] : key
}

export function channelLabel(channel: string): string {
  return channel in CHANNEL_LABELS ? CHANNEL_LABELS[channel as NotificationChannel] : channel
}
