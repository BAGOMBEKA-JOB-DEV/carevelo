import type { Metadata } from 'next'
import { AccessNotice, authoriseOperator } from '@/domains/identity'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { PlannedSection } from '@/components/PlannedSection'

/**
 * Still a planned section, and now the only one — which makes it worth writing down WHY,
 * rather than leaving it looking like the screen nobody got round to.
 *
 * THERE IS NO PLATFORM AUDIT ENDPOINT. docs/40-api/openapi.yaml publishes exactly one audit
 * read: `GET /v1/audit-events`. The endpoint catalogue marks it "S admin. Read-only.
 * Tenant-scoped" — a clinic administrator reading their own clinic's trail, scoped from
 * their session's tenant.
 *
 * A platform operator on `admin.carevelo.app` has no tenant for that endpoint to scope to,
 * and docs/50-security-compliance/rbac-matrix.md describes something different again:
 * platform roles read PLATFORM events in full and METADATA ONLY for a clinic's events. That
 * is a distinct projection of a distinct data set and no published endpoint returns it. Nor
 * is there anywhere to read the events this surface most needs a trail for — its own
 * break-glass requests and grants, which the RBAC matrix names as platform events that carry
 * no tenant and sit outside tenant row-level security.
 *
 * So this stays a planned section rather than becoming a screen built against
 * `/v1/audit-events`, which would either refuse every platform session or — far worse if the
 * policy were ever loosened to admit one — hand a platform operator a clinic's full audit
 * trail on a surface whose entire premise is that it reaches no clinical data.
 *
 * The one audit-shaped view this app CAN honestly offer is the break-glass register, and it
 * offers it: every grant ever issued, its scope, its stated reason, its expiry and whether
 * the clinic was notified. That is at /break-glass.
 *
 * THE AUTHORISATION IS REAL EVEN THOUGH THE SCREEN IS NOT. Every page on this surface is
 * behind authentication, and a placeholder that skipped the check would be the one route an
 * unauthenticated request could reach — which is exactly the kind of gap that survives
 * review because the page looks like it does nothing.
 */
export const metadata: Metadata = { title: 'Audit' }

export default async function AuditPage() {
  const access = await authoriseOperator()

  if (access.kind !== 'operator') {
    return (
      <ControlPlaneShell title="Audit" active="audit">
        <AccessNotice access={access} />
      </ControlPlaneShell>
    )
  }

  return <PlannedSection id="audit" />
}
