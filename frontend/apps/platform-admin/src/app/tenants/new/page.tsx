import type { Metadata } from 'next'
import { Badge, Notice, PageHeader } from '@carevelo/ui'
import { AccessNotice, authoriseOperator } from '@/domains/identity'
import { ProvisionScreen } from '@/domains/platform'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { PLATFORM_PATHS } from '../../paths'

/**
 * Provisioning a clinic.
 *
 * `platform_admin` ONLY, and the refusal is rendered here rather than deep in the screen.
 * `platform_support` is read-only on the register — the tenant register links to this page
 * only for a role that may use it, so an operator who arrives here without the capability
 * has typed the URL or followed a stale link, and the honest answer is which role it needs.
 *
 * IT IS AN AFFORDANCE, NOT A CONTROL. The API authorises three times over and this check
 * protects nothing; what it buys is an operator who is told why rather than one who fills in
 * ten fields and is answered with a 403.
 */
export const metadata: Metadata = { title: 'Provision a clinic' }

export default async function ProvisionPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string; message?: string; fields?: string }>
}) {
  const [access, params] = await Promise.all([authoriseOperator(), searchParams])

  if (access.kind !== 'operator') {
    return (
      <ControlPlaneShell title="Provision a clinic" active="tenants">
        <AccessNotice access={access} />
      </ControlPlaneShell>
    )
  }

  if (!access.can.provision) {
    return (
      <ControlPlaneShell title="Provision a clinic" active="tenants">
        {/* The `<h1>` for this branch. It and `ProvisionScreen`'s are mutually exclusive —
            the page returns one or the other and never both — so there is exactly one on
            whichever version of this route renders. */}
        <PageHeader
          title="Provision a clinic"
          description="Not available to this account."
          actions={<Badge tone="warn">Refused</Badge>}
        />
        <Notice tone="info" icon="lock" title="This needs platform_admin">
          Provisioning, suspension, resumption and export belong to{' '}
          <code>platform_admin</code>. <code>platform_support</code> reads the register and
          requests break-glass grants, and that is the whole of it.
        </Notice>
      </ControlPlaneShell>
    )
  }

  return (
    <ControlPlaneShell title="Provision a clinic" active="tenants">
      <ProvisionScreen
        paths={PLATFORM_PATHS}
        problem={params.problem}
        message={params.message}
        fields={params.fields}
      />
    </ControlPlaneShell>
  )
}
