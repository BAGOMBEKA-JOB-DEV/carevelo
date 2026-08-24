import type { Metadata } from 'next'
import { StaffMemberScreen } from '@/domains/tenant'
import { TENANT_PATHS } from '../../paths'

/**
 * One colleague.
 *
 * Pass-through, including the id. The screen resolves the colleague itself and decides what
 * a failure means — a 404 for an id that names nobody in this clinic, and a readable
 * explanation for an expired session or a caller who is not an administrator. Those are
 * three different answers to one call, and a route that chose between them would be a route
 * holding logic.
 */
export const metadata: Metadata = { title: 'Colleague' }

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ user: string }>
  searchParams: Promise<{ saved?: string | string[]; problem?: string | string[] }>
}) {
  const [{ user }, search] = await Promise.all([params, searchParams])

  return (
    <div className="grid">
      <p>
        <a className="lnk" href={TENANT_PATHS.staff}>
          ← All colleagues
        </a>
      </p>

      <StaffMemberScreen
        paths={TENANT_PATHS}
        userId={user}
        saved={search.saved}
        problem={search.problem}
      />
    </div>
  )
}
