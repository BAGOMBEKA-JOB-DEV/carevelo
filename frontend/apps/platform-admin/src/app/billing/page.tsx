import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { AccessNotice, authoriseOperator } from '@/domains/identity'
import { BillingRegisterScreen } from '@/domains/platform'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { IDENTITY_PATHS, PLATFORM_PATHS } from '../paths'

/**
 * The subscription register: which clinics owe us money, and which have lapsed.
 *
 * A SEPARATE ROUTE FROM /tenants, and the separation is the point. That register answers
 * "who are our clinics and what lifecycle state is each in" — an operational question asked
 * while provisioning or suspending. This one answers a commercial one, and it is the screen
 * somebody opens at the end of a month. They share their rows and nothing else, and folding
 * them together would put the question the console is opened for in competition with the
 * one it is worked in.
 *
 * EVERY SEARCH PARAMETER IS CARRIED, NOT INTERPRETED, exactly as /tenants does it. Which
 * statuses are real, what `problem=refused` means and which of these are safe to render is
 * the platform domain's business and is decided there against a closed set. A route that
 * began translating them into props with meanings of its own would be the billing rules
 * restated in the routing tree, free to drift from the screen that enforces them.
 *
 * THE MONEY HERE IS CAREVELO'S OWN, which is the whole reason this screen may exist at all.
 * A clinic's patient payments never pass through Carevelo — they go to that clinic's own
 * Pesapal account, and ADR-0003 is built so they cannot do otherwise. What a subscription
 * charge collects is Carevelo's subscription revenue, billed to the clinic, and it lives in
 * a platform-scoped domain outside row-level security precisely so the two can never be read
 * or written through one path.
 */
export const metadata: Metadata = { title: 'Billing' }

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    cursor?: string
    tenant?: string
    problem?: string
    message?: string
  }>
}) {
  const [access, params] = await Promise.all([authoriseOperator(), searchParams])

  if (access.kind === 'guest') {
    // A request with no session gets the sign-in screen. `no-role` below is a different
    // answer and stays one — that browser HAS a session, and flattening the two would leave
    // an operator whose session idled out believing the console had been taken away.
    redirect(IDENTITY_PATHS.signIn)
  }

  if (access.kind !== 'operator') {
    return (
      <ControlPlaneShell title="Billing" active="billing">
        <AccessNotice operator={access.operator} paths={IDENTITY_PATHS} />
      </ControlPlaneShell>
    )
  }

  return (
    <ControlPlaneShell title="Billing" active="billing">
      <BillingRegisterScreen
        can={access.can}
        paths={PLATFORM_PATHS}
        status={params.status}
        cursor={params.cursor}
        tenant={params.tenant}
        problem={params.problem}
        message={params.message}
      />
    </ControlPlaneShell>
  )
}
