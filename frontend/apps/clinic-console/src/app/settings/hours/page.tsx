import type { Metadata } from 'next'
import { OnboardingChecklist, WorkingHoursScreen } from '@/domains/tenant'
import { TENANT_PATHS } from '../paths'

/** When the clinic is open. Pass-through. */
export const metadata: Metadata = { title: 'Opening hours' }

export default async function HoursSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[]; problem?: string | string[] }>
}) {
  const params = await searchParams

  return (
    <div className="grid">
      <OnboardingChecklist paths={TENANT_PATHS} compact />
      <WorkingHoursScreen paths={TENANT_PATHS} saved={params.saved} problem={params.problem} />
    </div>
  )
}
