import type { Metadata } from 'next'
import { OnboardingChecklist, StaffScreen } from '@/domains/tenant'
import { TENANT_PATHS } from '../paths'

/**
 * The staff list.
 *
 * `cursor` is the API's own opaque cursor, carried through untouched. The route neither
 * constructs one nor inspects one: cursor pagination is the API's contract, and a route
 * that tried to help — by remembering a page number, say — would be the thing that turns
 * a stable list into one that skips and repeats colleagues.
 */
export const metadata: Metadata = { title: 'Colleagues' }

export default async function StaffSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string | string[]
    saved?: string | string[]
    problem?: string | string[]
  }>
}) {
  const params = await searchParams

  return (
    <div className="grid">
      <OnboardingChecklist paths={TENANT_PATHS} compact />
      <StaffScreen
        paths={TENANT_PATHS}
        cursor={params.cursor}
        saved={params.saved}
        problem={params.problem}
      />
    </div>
  )
}
