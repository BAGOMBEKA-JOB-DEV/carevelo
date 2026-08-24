import type { Metadata } from 'next'
import { OnboardingChecklist, PaymentConnectionScreen } from '@/domains/tenant'
import { TENANT_PATHS } from '../paths'

/**
 * The clinic's own payment connection.
 *
 * `aggregator` is deliberately a separate parameter from `problem`. One is Carevelo
 * refusing something; the other is a third party reporting on a credential, shown verbatim.
 * Collapsing the two would let an administrator read "invalid API key" as a Carevelo bug
 * and open a support ticket with the wrong company.
 */
export const metadata: Metadata = { title: 'Taking payment' }

export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string | string[]
    problem?: string | string[]
    aggregator?: string | string[]
  }>
}) {
  const params = await searchParams

  return (
    <div className="grid">
      <OnboardingChecklist paths={TENANT_PATHS} compact />
      <PaymentConnectionScreen
        paths={TENANT_PATHS}
        saved={params.saved}
        problem={params.problem}
        aggregatorMessage={params.aggregator}
      />
    </div>
  )
}
