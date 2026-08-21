import type { Metadata } from 'next'
import { AccessNotice, authoriseOperator } from '@/domains/identity'
import { TenantRegisterScreen } from '@/domains/platform'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { PLATFORM_PATHS } from '../paths'

/**
 * The tenant register.
 *
 * EVERY SEARCH PARAMETER IS CARRIED, NOT INTERPRETED. `status`, `cursor`, `tenant`,
 * `problem`, `message` and `provisioned` are read off the URL and handed to the screen
 * exactly as they arrived. What `problem=refused` means, which statuses are real and which
 * of these are safe to render is the platform domain's business and is decided there against
 * a closed set. A route that started translating them into props with meanings of its own
 * would be the lifecycle rules restated in the routing tree, free to drift from the screen
 * they govern.
 *
 * `?tenant=` OPENS A PANEL RATHER THAN A DETAIL ROUTE, and that is a consequence of the
 * contract rather than a preference: there is no `GET /v1/platform/tenants/{tenant}`, so a
 * `/tenants/[tenant]` route would have to page through the index looking for its clinic. See
 * TenantPanel.tsx.
 *
 * CURSOR PAGINATION IS THE ONLY PAGINATION HERE. There is no page number to plumb because
 * the API pages by cursor: clinics are provisioned and suspended while somebody reads the
 * register, and that is exactly the traffic under which an offset duplicates and skips rows.
 */
export const metadata: Metadata = { title: 'Tenants' }

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    cursor?: string
    tenant?: string
    problem?: string
    message?: string
    provisioned?: string
  }>
}) {
  const [access, params] = await Promise.all([authoriseOperator(), searchParams])

  if (access.kind !== 'operator') {
    return (
      <ControlPlaneShell title="Tenants" active="tenants">
        <AccessNotice access={access} />
      </ControlPlaneShell>
    )
  }

  return (
    <ControlPlaneShell title="Tenants" active="tenants">
      <TenantRegisterScreen
        can={access.can}
        paths={PLATFORM_PATHS}
        status={params.status}
        cursor={params.cursor}
        tenant={params.tenant}
        problem={params.problem}
        message={params.message}
        provisioned={params.provisioned}
      />
    </ControlPlaneShell>
  )
}
