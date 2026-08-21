import type { Metadata } from 'next'
import { ComplianceScreen, OnboardingChecklist } from '@/domains/tenant'
import { TENANT_PATHS } from '../paths'

/** Clinic details and compliance references. Pass-through; the domain owns the meaning. */
export const metadata: Metadata = { title: 'Clinic details' }

export default async function ComplianceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[]; problem?: string | string[] }>
}) {
  const params = await searchParams

  return (
    <div className="grid">
      <OnboardingChecklist paths={TENANT_PATHS} compact />
      <ComplianceScreen paths={TENANT_PATHS} saved={params.saved} problem={params.problem} />
    </div>
  )
}
