import { resolveTenant } from '@/lib/tenant'
import { SiteShell } from '@/components/SiteShell'
import { PageBody } from '@/components/PageBody'
import { PaymentCheckoutReturn } from '@/domains/payments/components/PaymentCheckoutReturn'
import type { PaymentIntent } from '@/domains/payments'

// TEMPORARY SCAFFOLD — deleted before this branch is handed back.
const CHECKOUT =
  'https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index?OrderTrackingId=PESAPAL-TRACK-0001'

export default async function HandoffPreview({
  searchParams,
}: {
  searchParams: Promise<{ collecting?: string }>
}) {
  const [tenant, query] = await Promise.all([resolveTenant(), searchParams])

  const intent = {
    id: '01J8XKQ9Z3MOCKINTENT000001',
    reference: 'CV-PAY-8H3K2M',
    status: query.collecting === undefined ? 'initiated' : 'pending',
    amount: { amount_minor: 3_000_000, currency: 'UGX' },
    method: 'mtn_momo',
    aggregator_reference: null,
    failure_message: null,
    initiated_at: null,
    resolved_at: null,
  } as unknown as PaymentIntent

  return (
    <SiteShell tenant={tenant} signedIn>
      <PageBody>
        <PaymentCheckoutReturn
          tenant={tenant}
          intent={intent}
          retryHref="/pay/appointment?appointment=x&after=01J8XKQ9Z3MOCKINTENT000001"
          checkoutUrl={CHECKOUT}
          collecting={query.collecting !== undefined}
        />
        <form action="/handoff-preview/go" method="post">
          <button type="submit" id="csp-probe">
            probe the redirect
          </button>
        </form>
      </PageBody>
    </SiteShell>
  )
}
