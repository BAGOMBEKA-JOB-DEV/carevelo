import { readClient } from '@/domains/identity'
import type { AuditEventsPage, AuditQuery } from '../model/types'

/**
 * Reading the evidence layer.
 *
 * ============================================================
 * ONE FUNCTION, BECAUSE THERE IS ONE VERB
 * ============================================================
 *
 * No write, no correction, no delete, and no endpoint to write one against. Audit events
 * are written by the API as a side effect of domain operations, and the application role
 * holds INSERT and SELECT on the table while being denied UPDATE and DELETE by database
 * grant — so an event cannot be edited whatever any client does. A "correct this entry"
 * control would be a button that could only ever fail, on the one screen where the product
 * has to be believed.
 *
 * ============================================================
 * `tenant_id` CHOOSES A TRAIL, IT DOES NOT NARROW A LIST
 * ============================================================
 *
 * Without it the API returns CAREVELO's own events — the ones carrying no tenant, which are
 * invisible from inside every clinic there is. With it, that clinic's events, as metadata
 * only. There is no response that mixes the two, and that is row-level security being
 * obeyed rather than worked around: audit_events is isolated in both directions, so a page
 * spanning clinics would need a policy letting an unbound reader see tenant rows.
 *
 * The screen therefore says which trail it is showing, always, rather than presenting one
 * list whose contents silently depend on a select box.
 *
 * ============================================================
 * THIS CALL IS ITSELF AUDITED
 * ============================================================
 *
 * Every one. The API writes an `audit_log.read` event into the platform trail naming the
 * operator, the filters and the clinic whose trail was read — including when this function
 * is called to render a page nobody chose to look at. Nothing here should be called
 * speculatively: a prefetch on this endpoint is a false entry in a security review.
 *
 * @see docs/50-security-compliance/audit-logging.md
 */
export async function listAuditEvents(query: AuditQuery = {}): Promise<AuditEventsPage> {
  const client = await readClient()

  return client.get<AuditEventsPage>('/v1/platform/audit-events', {
    query: {
      tenant_id: query.tenant_id,
      action: query.action,
      actor_id: query.actor_id,
      from: query.from,
      to: query.to,
      per_page: query.per_page,
      cursor: query.cursor,
    },
  })
}
