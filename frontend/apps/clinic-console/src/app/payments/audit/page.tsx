import type { Metadata } from 'next'
import { AuditLogScreen, listAuditEvents, type AuditFilters } from '@/domains/audit'
import { SectionNav } from '@/domains/payments'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The evidence layer, read-only.
 *
 * EVERY LOAD OF THIS PAGE WRITES AN AUDIT EVENT. `audit_log.read`, naming the reader and the
 * filters they used — otherwise the trail would have a blind spot exactly where an insider
 * would look. Three consequences for this route, none of them optional:
 *
 *   Do not cache it. It reads cookies through the API client so it is dynamic already; adding
 *   caching would mean one clinic's read serving another's page as well as hiding reads from
 *   the trail.
 *
 *   Do not refresh it on a timer, and do not add a realtime subscription to it. A polling
 *   audit screen fills the clinic's own trail with its own reads and buries the signal an
 *   investigator came for under the noise of the tool they came with.
 *
 *   Do not prefetch it from anywhere. A hovered link that quietly records a read is a lie in
 *   an evidence record.
 *
 * FILTERS ARE PASSED THROUGH UNVALIDATED, deliberately. The API validates each one — an
 * identifier must be a ULID, `to` must not be before `from` — and returns a sentence saying
 * which was wrong. Re-implementing those rules here would be a second copy free to drift, and
 * the copy that disagrees with the API is the one that produces a screen refusing input the
 * server would have accepted.
 */
export const metadata: Metadata = { title: 'Audit log' }

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string
    actor_id?: string
    subject_type?: string
    subject_id?: string
    from?: string
    to?: string
    cursor?: string
  }>
}) {
  const params = await searchParams

  /*
   * Assigned rather than spread, because `exactOptionalPropertyTypes` distinguishes "absent"
   * from "explicitly undefined" — and an empty string from a cleared form field is not a
   * filter, it is the absence of one. Sending `action=` would be a filter the API tries to
   * match.
   */
  const filters: AuditFilters = {}
  const carried = [
    ['action', params.action],
    ['actorId', params.actor_id],
    ['subjectType', params.subject_type],
    ['subjectId', params.subject_id],
    ['from', params.from],
    ['to', params.to],
    ['cursor', params.cursor],
  ] as const satisfies readonly (readonly [keyof AuditFilters, string | undefined])[]

  for (const [key, value] of carried) {
    if (value !== undefined && value !== '') {
      filters[key] = value
    }
  }

  const page = await listAuditEvents(filters)

  return (
    <ConsoleShell title="Payments" active="payments">
      <SectionNav active="audit" />
      <AuditLogScreen page={page} filters={filters} selfPath="/payments/audit" />
    </ConsoleShell>
  )
}
