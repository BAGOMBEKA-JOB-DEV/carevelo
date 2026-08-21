import type { Metadata } from 'next'
import { AccessNotice, authoriseOperator } from '@/domains/identity'
import { OverviewScreen } from '@/domains/platform'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { PLATFORM_PATHS } from './paths'

/**
 * The landing screen: platform health, and the break-glass count with the framing that
 * makes it mean something.
 *
 * THIN BY DESIGN. A route resolves, authorises and hands off; it holds no logic, which
 * `.dependency-cruiser.cjs` enforces. Everything this page knows about health, isolation or
 * tenant counts is in the platform domain.
 *
 * `active={null}`: this is not one of the nav sections and it says so out loud rather than
 * leaving the prop off. `ControlPlaneShell` requires the prop for that reason — it was
 * optional once, the layout rendered the shell and never passed it, and no nav item could
 * ever be current.
 *
 * WHY HEALTH LIVES HERE AND NOT ON A `/health` ROUTE. The nav is generated from
 * `src/components/sections.ts`, which lists three sections and is not this change's to edit.
 * The landing page is where an operator arrives anyway, and a set of platform-wide counts is
 * what a landing page is for. Adding a fourth nav entry is a one-line change to that file if
 * it is ever wanted.
 */
export const metadata: Metadata = { title: 'Overview' }

export default async function HomePage() {
  const access = await authoriseOperator()

  if (access.kind !== 'operator') {
    return (
      <ControlPlaneShell title="Platform admin" active={null}>
        <AccessNotice access={access} />
      </ControlPlaneShell>
    )
  }

  return (
    <ControlPlaneShell title="Platform admin" active={null}>
      <OverviewScreen paths={PLATFORM_PATHS} />
    </ControlPlaneShell>
  )
}
