import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { AccessNotice, attempt, authoriseOperator } from '@/domains/identity'
import { AuditRegisterScreen } from '@/domains/audit'
import { listAllTenants } from '@/domains/platform'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { AUDIT_PATHS, IDENTITY_PATHS } from '../paths'

/**
 * Audit — the evidence layer, read back.
 *
 * THIS ROUTE WAS A PLANNED SECTION AND IS THE ONE THAT BECAME A SCREEN LAST, for a reason
 * worth keeping: there was no endpoint to build it against. `GET /v1/audit-events` is
 * tenant-scoped and clinic-admin-only; a platform operator has no tenant for it to scope
 * to; and the events this surface most needs — its own break-glass grants — carry a null
 * tenant and sit outside tenant row-level security, invisible from inside every clinic.
 * `GET /v1/platform/audit-events` is the endpoint that closes that, and it publishes a
 * DIFFERENT PROJECTION rather than the same query with the scope taken off.
 *
 * THE ROUTE COMPOSES TWO DOMAINS, WHICH IS WHAT THE ROUTE LAYER IS FOR. The audit domain
 * needs the clinic register so the trail picker can name real clinics instead of asking for
 * an identifier, and that register belongs to the platform domain.
 * `.dependency-cruiser.cjs` would permit the audit domain to import platform's index.ts
 * directly and its own comment says composing here is better — and it is better for a
 * concrete reason: whether a failed register read may take this screen down is a
 * route-layer decision, and the answer is no. A failed read becomes `clinics: null` and the
 * picker degrades to an identifier field.
 *
 * ONE FETCH PER LOAD, AND NO PREFETCH. Reading the register writes an `audit_log.read`
 * event naming the operator; a speculative fetch would be a false entry in a security
 * review. Nothing on this route is prefetched and nothing revalidates on a timer.
 *
 * THE AUTHORISATION IS THE SAME THREE LINES AS EVERY OTHER PAGE HERE, and on this one it
 * carries more: this is the widest read surface in the product. The API refuses a session
 * that has not completed a second factor and refuses any account that is not a platform
 * operator, so nothing below is the control — but a page that skipped the check would send
 * an operator's browser at a cross-tenant endpoint and render whatever came back.
 */
export const metadata: Metadata = { title: 'Audit' }

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    tenant_id?: string
    action?: string
    actor_id?: string
    from?: string
    to?: string
    cursor?: string
  }>
}) {
  const [access, params] = await Promise.all([authoriseOperator(), searchParams])

  if (access.kind === 'guest') {
    /*
     * NOT a notice, and not a 404. There is a sign-in screen now, and the honest answer to
     * a request with no session is to show it. `no-role` below is a different answer and
     * stays one: that browser HAS a session, and flattening the two would leave an operator
     * whose session simply idled out believing the console had been taken away from them.
     */
    redirect(IDENTITY_PATHS.signIn)
  }

  if (access.kind !== 'operator') {
    return (
      <ControlPlaneShell title="Audit" active="audit">
        <AccessNotice operator={access.operator} paths={IDENTITY_PATHS} />
      </ControlPlaneShell>
    )
  }

  /*
   * BOTH PLATFORM ROLES READ THIS. docs/50-security-compliance/rbac-matrix.md gives
   * "Audit log — read: metadata" in the `platform_support` and `platform_admin` columns
   * alike, so there is no capability to consult here and none is invented: support meets
   * the incident first, and a register that made them escalate to read metadata would
   * produce either a delay or a shared login.
   */
  const register = await attempt(listAllTenants())

  return (
    <ControlPlaneShell title="Audit" active="audit">
      <AuditRegisterScreen
        paths={AUDIT_PATHS}
        clinics={register.ok ? register.value.tenants : null}
        clinicsComplete={register.ok ? register.value.complete : false}
        tenantId={params.tenant_id}
        action={params.action}
        actorId={params.actor_id}
        from={params.from}
        to={params.to}
        cursor={params.cursor}
      />
    </ControlPlaneShell>
  )
}
