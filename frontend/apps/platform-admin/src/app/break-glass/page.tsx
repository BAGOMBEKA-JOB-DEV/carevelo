import type { Metadata } from 'next'
import { AccessNotice, attempt, authoriseOperator } from '@/domains/identity'
import { BreakGlassScreen } from '@/domains/break-glass'
import { getHealth, listAllTenants } from '@/domains/platform'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { BREAK_GLASS_PATHS } from '../paths'

/**
 * Break-glass: requesting time-boxed access to a clinic's records, and the register of every
 * grant ever issued.
 *
 * THE ROUTE COMPOSES TWO DOMAINS, WHICH IS WHAT THE ROUTE LAYER IS FOR. The break-glass
 * domain needs two things it should not fetch for itself:
 *
 *   `clinics` — so the request form names real clinics instead of asking for a UUID. This is
 *   the platform domain's register.
 *
 *   `activeGrants` — the platform-wide live count, which comes from `GET
 *   /v1/platform/health` rather than from counting rows, so the headline figure does not
 *   depend on how somebody paged through the register.
 *
 * `.dependency-cruiser.cjs` would permit break-glass to import the platform domain's
 * index.ts directly, and its own comment says composing in the route is better. It is better
 * here for a concrete reason: BOTH of these reads are allowed to fail without taking the
 * screen down, and deciding that is a route-layer decision. Which brings us to —
 *
 * NEITHER READ MAY BLOCK THE FORM. This screen is used during an incident, and an incident
 * is exactly when a dependency is unwell. A failed register read becomes `clinics: null` and
 * the form degrades to a plain identifier field; a failed health read becomes
 * `activeGrants: null` and the screen counts what is in front of it and says so. A
 * break-glass screen that cannot be used because a LIST failed is a break-glass screen that
 * is not there when it is needed.
 *
 * BOTH PLATFORM ROLES MAY REQUEST. `platform_support` is read-only on the tenant register
 * and is NOT read-only here — support meets the incident first, and a control that forces an
 * escalation before anything can be looked at produces either a delay in front of a patient
 * or a shared login. See identity's model/roles.ts.
 */
export const metadata: Metadata = { title: 'Break-glass' }

export default async function BreakGlassPage({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string
    requested?: string
    problem?: string
    message?: string
  }>
}) {
  const [access, params] = await Promise.all([authoriseOperator(), searchParams])

  if (access.kind !== 'operator') {
    return (
      <ControlPlaneShell title="Break-glass" active="break-glass">
        <AccessNotice access={access} />
      </ControlPlaneShell>
    )
  }

  const [register, health] = await Promise.all([attempt(listAllTenants()), attempt(getHealth())])

  return (
    <ControlPlaneShell title="Break-glass" active="break-glass">
      <BreakGlassScreen
        paths={BREAK_GLASS_PATHS}
        canRequest={access.can.requestBreakGlass}
        clinics={register.ok ? register.value.tenants : null}
        clinicsComplete={register.ok ? register.value.complete : false}
        activeGrants={health.ok ? health.value.break_glass.active_grants : null}
        cursor={params.cursor}
        requested={params.requested}
        problem={params.problem}
        message={params.message}
      />
    </ControlPlaneShell>
  )
}
