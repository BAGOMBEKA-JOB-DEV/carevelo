import type { Metadata } from 'next'
import { OnboardingChecklist, ServicesScreen } from '@/domains/tenant'
import { TENANT_PATHS } from '../paths'

/** What the clinic offers and what it charges. Pass-through. */
export const metadata: Metadata = { title: 'Services and prices' }

export default async function ServicesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[]; problem?: string | string[] }>
}) {
  const params = await searchParams

  return (
    <div className="grid">
      <OnboardingChecklist paths={TENANT_PATHS} compact />
      <ServicesScreen paths={TENANT_PATHS} saved={params.saved} problem={params.problem} />
    </div>
  )
}
