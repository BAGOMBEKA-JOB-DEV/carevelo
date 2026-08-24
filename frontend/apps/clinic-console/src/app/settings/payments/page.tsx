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
 *
 * `provider` decides which aggregator's vocabulary the credential panel is dressed in —
 * Flutterwave asks for a secret key, Pesapal for a consumer key and consumer secret, and
 * labelling one with the other's words sends an administrator looking for something their
 * aggregator has never issued. It is carried on the URL rather than held in state because
 * these forms post natively, with the bundle in flight or switched off entirely; the screen
 * validates it and falls back to whatever this clinic has already connected.
 *
 * The route reads the parameters and passes them through. It does not narrow them: Next
 * types a search parameter `string | string[] | undefined` because `?provider=a&provider=b`
 * is a legal URL, and the screen owns the meaning.
 */
export const metadata: Metadata = { title: 'Taking payment' }

export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    provider?: string | string[]
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
        provider={params.provider}
        saved={params.saved}
        problem={params.problem}
        aggregatorMessage={params.aggregator}
      />
    </div>
  )
}
