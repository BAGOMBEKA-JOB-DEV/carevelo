/**
 * The audit domain's PUBLIC SURFACE.
 *
 * Everything this domain offers the rest of the app is exported here and nothing else is
 * importable: reaching into ./components or ./api from another domain is a build failure,
 * not a code-review note. Cross-domain composition belongs in the route layer.
 *
 * ------------------------------------------------------------------
 * WHAT A ROUTE HAS TO DO WITH THIS.
 *
 *   const filters = readFilters(params)
 *   const page = await listAuditEvents(filters)
 *
 *   <AuditLogScreen page={page} filters={filters} selfPath="/payments/audit" />
 *
 * `listAuditEvents` returns an `Attempt` and does not throw. A 403 means the reader is not a
 * clinic administrator, which is the boundary working rather than a fault, and the screen
 * renders it as such — the route must not turn it into an error page.
 *
 * DO NOT CACHE THIS ROUTE AND DO NOT REFRESH IT ON A TIMER. Every read writes an
 * `audit_log.read` event naming the reader and their filters, so a polling audit screen
 * would fill the clinic's own trail with its own reads and bury the signal an investigator
 * came for.
 *
 * ------------------------------------------------------------------
 * WHAT THIS DOMAIN WILL NEVER OFFER.
 *
 * ANY WRITE. There is one route to the audit trail and it is a GET. Events are written by
 * the system as a side effect of domain operations; nothing can update or delete one,
 * because the application's database role is granted INSERT and SELECT and denied UPDATE and
 * DELETE. Build no control that writes or removes a line — not an edit, not a delete, not a
 * retention setting, not a "clear old events". If one is ever genuinely needed it is a
 * migration and a decision record, not a screen.
 *
 * A METADATA SEARCH. The API accepts no filter over `metadata`, deliberately: querying by
 * metadata value would turn the trail into a search index over whatever a caller once put
 * there, which is the problem this log is designed not to have.
 *
 * @see docs/50-security-compliance/audit-logging.md
 * @see docs/70-decisions/0006-audit-log-immutability.md
 */

/* ---- Data. For a route to fetch and hand to the screen. ---- */
export { listAuditEvents } from './api/auditEvents'
export type { AuditEvent, AuditFilters, AuditPage } from './api/types'

/* ---- The screen. ---- */
export { AuditLogScreen, type AuditLogScreenProps } from './components/AuditLogScreen'
