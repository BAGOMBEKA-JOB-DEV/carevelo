import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { AccessNotice, authoriseOperator } from '@/domains/identity'
import { OverviewScreen } from '@/domains/platform'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { IDENTITY_PATHS, PLATFORM_PATHS } from './paths'

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
      <ControlPlaneShell title="Platform admin" active={null}>
        <AccessNotice operator={access.operator} paths={IDENTITY_PATHS} />
      </ControlPlaneShell>
    )
  }

  return (
    <ControlPlaneShell title="Platform admin" active={null}>
      <OverviewScreen paths={PLATFORM_PATHS} />
    </ControlPlaneShell>
  )
}
