import type { components, operations } from '@carevelo/api-client'

/**
 * Every shape this domain handles, taken from the generated contract.
 *
 * Not one of them is hand-written. A hand-written response interface is a second copy of
 * the contract that nothing checks, and it drifts the first time the API adds a field —
 * which on THIS surface would mean a screen quietly rendering a clinic's audit trail with a
 * field the API added and the projection never meant to show.
 */

/**
 * One line of the evidence layer, as a platform operator may read it.
 *
 * TWO PROJECTIONS SHARE THIS TYPE, and `projection` says which one a row is:
 *
 *   `full` — a PLATFORM event. Null `tenant_id`, and that is what makes it one:
 *   break-glass grants, tenant provisioning and suspension, TOTP enrolments, platform
 *   sign-ins. Carevelo's own actions, returned whole.
 *
 *   `metadata_only` — a CLINIC's event. `metadata`, `subject_id`, `ip_address` and
 *   `user_agent` come back null whatever the row holds, because a platform operator may see
 *   THAT something happened, to which clinic, by which actor and when — and never the
 *   clinical payload, never which record, never the clinic staff member's address.
 *
 * The API decides which per row; nothing on this screen can ask for the wider one. A null
 * here therefore means one of two different things — "withheld" or "genuinely empty" — and
 * `projection` is the only way to tell them apart, which is why the screen renders the
 * distinction rather than showing an empty cell for both.
 *
 * @see docs/50-security-compliance/audit-logging.md § Access
 */
export type AuditEvent = components['schemas']['PlatformAuditEventResource']

/** `full` for Carevelo's own events, `metadata_only` for a clinic's. */
export type AuditProjection = AuditEvent['projection']

/** The filters, exactly as `GET /v1/platform/audit-events` accepts them. */
export type AuditQuery = NonNullable<
  operations['v1.platform.audit-events.index']['parameters']['query']
>

type AuditIndex =
  operations['v1.platform.audit-events.index']['responses'][200]['content']['application/json']

/**
 * The cursor envelope Laravel puts on every cursor-paginated index in this API.
 *
 * ============================================================
 * WHY IT IS BORROWED FROM THE NEIGHBOURING OPERATION
 * ============================================================
 *
 * `v1.platform.audit-events.index` publishes `data` and nothing else, and that is a hole in
 * the GENERATED contract rather than in the endpoint: the response really does carry
 * `links` and `meta`, exactly as the break-glass register beside it does, because both are
 * `Resource::collection($cursorPaginator)`.
 *
 * Scramble infers a response by reading the controller, and it recognises a paginator only
 * when the `cursorPaginate()` call flows to the return with no branch in between. Reading a
 * CLINIC's trail has to happen inside `Tenancy::run()` — a closure, because the tenant
 * setting is transaction-scoped and that is the whole isolation control — so the paginator
 * reaches the resource through a callback the inference cannot follow, and the envelope is
 * dropped from the document.
 *
 * The alternative was to reshape the endpoint around what a documentation generator can
 * see. That is the wrong way round, and the shapes it would have cost — a second RLS policy
 * letting an unbound context read tenant rows, or a middleware binding a tenant from a query
 * parameter — are exactly the shapes the isolation model exists to refuse.
 *
 * So the envelope is taken from `v1.platform.break-glass.index`, which Scramble DID infer.
 * Both halves of the type below come from the generated contract; neither is retyped here.
 * It is one framework-level shape, identical on every cursor-paginated index in this API,
 * and if it ever changes it changes for both operations at once and this stops compiling.
 */
type CursorEnvelope = Omit<
  operations['v1.platform.break-glass.index']['responses'][200]['content']['application/json'],
  'data'
>

/**
 * A page of the register.
 *
 * CURSOR, NOT OFFSET, and on this endpoint that is not a preference: reading the audit log
 * WRITES to the audit log — the read is itself audited — so the list grows underneath
 * whoever is paging through it. That is precisely the traffic under which an offset
 * duplicates rows and skips them, and a skipped row on a security review is the row nobody
 * looked at.
 */
export type AuditEventsPage = AuditIndex & CursorEnvelope

/**
 * Where the route layer has mounted this domain's screen, and the two links off it.
 *
 * PASSED IN RATHER THAN GUESSED, like every other destination in this app: a domain that
 * hard-coded `/audit` could not be moved or mounted twice, and nothing in this folder
 * should know a literal path.
 */
export type AuditPaths = {
  /** Where `<AuditRegisterScreen>` is mounted. Receives the filters and `?cursor=`. */
  register: string
  /** The break-glass register: where record-level questions go instead. */
  breakGlass: string
  /** The platform overview, for the one link back. */
  overview: string
}
