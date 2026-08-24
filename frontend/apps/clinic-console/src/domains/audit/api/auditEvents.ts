import type { operations } from '@carevelo/api-client'
import { attempt, readClient, type Attempt } from './http'
import { auditPageFrom, type AuditFilters, type AuditPage } from './types'

/**
 * The one read this domain makes, and the reason there is no second function in this file.
 *
 * THE AUDIT LOG IS READ-ONLY FOR EVERYONE, INCLUDING CAREVELO. There is one route to it and
 * no API can write, update or delete an event: events are written by the system as a side
 * effect of domain operations, and the application's database role is granted INSERT and
 * SELECT while being denied UPDATE and DELETE. So an attacker with code execution cannot
 * cover their tracks, and neither can a support engineer with the best of intentions.
 *
 * Nothing in this domain may offer a control that writes or removes a line. Not a "clear
 * old events" button, not a retention slider, not an edit. If one is ever needed it is a
 * database migration and a decision record, not a screen.
 *
 * READING THE TRAIL IS ITSELF AUDITED. Every call to this function writes an
 * `audit_log.read` event naming the reader and the filters they used — otherwise the log
 * would have a blind spot exactly where an insider would look, and somebody checking whether
 * their own access had been noticed would leave no trace of having checked. Worth knowing
 * before adding a component that calls this on a timer: a polling audit screen would fill
 * the clinic's own trail with its own reads.
 *
 * @see backend/app/Http/Controllers/Api/V1/AuditEventController.php
 * @see docs/70-decisions/0006-audit-log-immutability.md
 */

type IndexResponse =
  operations['v1.audit-events.index']['responses'][200]['content']['application/json']

/**
 * One page of the clinic's own trail.
 *
 * TENANT-SCOPED BY ROW-LEVEL SECURITY, not by anything sent from here. A clinic sees its own
 * and only its own; platform-level events carry a null tenant and are invisible from inside
 * a clinic, in both directions. There is no tenant filter to pass and there must never be
 * one.
 *
 * CURSOR, NEVER OFFSET. The trail grows while it is being paged through — including from
 * this very read — and an offset would duplicate and skip rows in a record whose entire
 * value is that it is complete.
 */
export async function listAuditEvents(filters: AuditFilters): Promise<Attempt<AuditPage>> {
  const result = await attempt(
    (async () => {
      const client = await readClient()

      return client.get<IndexResponse>('/v1/audit-events', {
        query: {
          action: filters.action,
          actor_id: filters.actorId,
          subject_type: filters.subjectType,
          subject_id: filters.subjectId,
          from: filters.from,
          to: filters.to,
          cursor: filters.cursor,
        },
      })
    })(),
  )

  return result.ok ? { ok: true, value: auditPageFrom(result.value) } : result
}
