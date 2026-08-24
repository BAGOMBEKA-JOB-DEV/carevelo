import type { components, operations } from '@carevelo/api-client'

/**
 * The shape of one line of the evidence layer.
 *
 * ------------------------------------------------------------------
 * WHY HALF THE FIELDS ARE `unknown` IN THE CONTRACT, AND WHAT THIS DOES ABOUT IT
 *
 * `AuditEventResource` is generated with `actor_type`, `actor_id`, `actor_role`,
 * `subject_type`, `subject_id`, `ip_address`, `user_agent` and `request_id` all typed
 * `unknown`. The backend reads each of them through `$this->getAttribute(...)`, which the
 * generator cannot see a type through. They are strings-or-null in practice.
 *
 * They are narrowed at runtime rather than cast, and the difference matters more here than
 * anywhere else in this app. A cast would let a non-string field reach React and render as
 * `[object Object]` in an evidence record somebody may have to produce in a dispute. The
 * narrowing turns anything unexpected into an explicit "not recorded", which is a truthful
 * statement about the row.
 *
 * ------------------------------------------------------------------
 * WHAT AN EVENT DELIBERATELY DOES NOT CONTAIN
 *
 * An event records THAT something happened to WHICH record. Reconstructing what the record
 * said requires the record itself, under its own authorisation. `metadata` is scrubbed twice
 * — once on write and once on read — against the same prohibited-content list the SMS
 * templates are checked against, and any key named for a clinical or personal field is
 * dropped whatever it contains. This domain does not attempt to re-enrich any of it.
 *
 * @see backend/app/Http/Resources/V1/AuditEventResource.php
 * @see docs/50-security-compliance/audit-logging.md
 */

/** The raw resource, exactly as the contract describes it. */
export type AuditEventResource = components['schemas']['AuditEventResource']

type IndexQuery = NonNullable<operations['v1.audit-events.index']['parameters']['query']>

/**
 * The filters the API accepts, and no others.
 *
 * NOTHING IN `metadata` CAN BE FILTERED, and that is a property of the log rather than a
 * missing feature. Querying by metadata value would turn the audit trail into a search index
 * over whatever a caller once put there, which is precisely the problem this log is designed
 * not to have.
 */
export type AuditFilters = {
  action?: IndexQuery['action']
  actorId?: IndexQuery['actor_id']
  subjectType?: IndexQuery['subject_type']
  subjectId?: IndexQuery['subject_id']
  /** `YYYY-MM-DD`, resolved against the CLINIC's day by the API. */
  from?: IndexQuery['from']
  to?: IndexQuery['to']
  cursor?: IndexQuery['cursor']
}

type IndexResponse =
  operations['v1.audit-events.index']['responses'][200]['content']['application/json']

/** One line of the trail, with every opaque field resolved to a string or an honest null. */
export type AuditEvent = {
  readonly id: string
  readonly action: string
  readonly occurredAt: string
  readonly actorId: string | null
  readonly actorType: string | null
  readonly actorRole: string | null
  readonly subjectType: string | null
  readonly subjectId: string | null
  readonly ipAddress: string | null
  /** The join key to the application logs: audit says what happened, logs say how it went. */
  readonly requestId: string | null
  /** Already scrubbed by the API, twice. Rendered as-is and never re-enriched. */
  readonly metadata: Readonly<Record<string, unknown>>
}

export type AuditPage = {
  readonly events: readonly AuditEvent[]
  readonly nextCursor: string | null
  readonly prevCursor: string | null
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function auditEventFrom(resource: AuditEventResource): AuditEvent {
  return {
    id: resource.id,
    action: resource.action,
    occurredAt: resource.occurred_at,
    actorId: textOrNull(resource.actor_id),
    actorType: textOrNull(resource.actor_type),
    actorRole: textOrNull(resource.actor_role),
    subjectType: textOrNull(resource.subject_type),
    subjectId: textOrNull(resource.subject_id),
    ipAddress: textOrNull(resource.ip_address),
    requestId: textOrNull(resource.request_id),
    metadata: resource.metadata,
  }
}

export function auditPageFrom(response: IndexResponse): AuditPage {
  return {
    events: response.data.map(auditEventFrom),
    nextCursor: response.meta.next_cursor,
    prevCursor: response.meta.prev_cursor,
  }
}

/**
 * A readable sentence for an action key, where this build knows one.
 *
 * AN OPEN LIST WITH A HONEST FALLBACK. Actions are plain strings written by whatever domain
 * operation produced them; new ones appear whenever the backend grows, and there is no
 * published enum to compile against. An unknown key renders as itself rather than as
 * "Unknown action" — the raw key is meaningful to anyone investigating, and hiding it behind
 * a label this build happens not to have would remove the only thing they can search for.
 *
 * The keys below are the ones this section of the console is most likely to be opened for.
 */
const ACTION_LABELS: Record<string, string> = {
  'audit_log.read': 'Someone read the audit log',
  'payment_intent.created': 'A payment was started',
  'payment_intent.cash_attested': 'Cash was attested at the clinic',
  'payment_intent.receipt_issued': 'A receipt was issued',
  'payment.amount_mismatch_flagged': 'A reported amount did not match',
  'reconciliation.exported': 'Payment records were exported',
}

export function actionLabel(action: string): string | null {
  return ACTION_LABELS[action] ?? null
}
