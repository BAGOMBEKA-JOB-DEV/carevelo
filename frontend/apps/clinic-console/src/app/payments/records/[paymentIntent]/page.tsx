import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { PaymentRecordScreen, SectionNav, getPaymentIntent, getReceipt, isSucceeded } from '@/domains/payments'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * One payment attempt.
 *
 * `getPaymentIntent` RETURNS NULL FOR 404 AND 403 ALIKE, so this renders one not-found page
 * for both. That is not laziness: the API answers a cross-tenant reference with 404
 * precisely so nobody can discover which clinic holds which record, and a console that
 * turned a 403 into a distinguishable screen would hand that distinction straight back.
 *
 * THE RECEIPT IS ONLY FETCHED FOR A SUCCEEDED ATTEMPT, because only a succeeded attempt has
 * one — the backend raises an illegal transition otherwise. Asking anyway would be a
 * guaranteed 409 and a wasted round trip on a screen somebody is standing at a counter
 * waiting for.
 *
 * NOT STATIC, AND MUST NOT BECOME SO. It reads cookies through the API client, so it is
 * dynamic already; do not add caching. A cached payment record is a front desk being told
 * about yesterday.
 */
export const metadata: Metadata = { title: 'Payment record' }

export default async function PaymentRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentIntent: string }>
  searchParams: Promise<{ attested?: string; problem?: string; message?: string }>
}) {
  const [{ paymentIntent }, query] = await Promise.all([params, searchParams])
  const intent = await getPaymentIntent(paymentIntent)

  if (intent === null) {
    notFound()
  }

  const receipt = isSucceeded(intent.status) ? await getReceipt(paymentIntent) : null
  const selfPath = `/payments/records/${encodeURIComponent(paymentIntent)}`

  return (
    <ConsoleShell title="Payments" active="payments">
      <SectionNav active="desk" />
      <PaymentRecordScreen
        intent={intent}
        receipt={receipt}
        selfPath={selfPath}
        /*
         * Compared against the literal '1' rather than coerced, because every other string —
         * including '0', 'false' and an empty value — must read as "no". `Boolean('0')` is
         * `true`, and a stale link would otherwise announce a cash payment that was never
         * recorded.
         */
        attested={query.attested === '1'}
        problem={query.problem}
        message={query.message}
      />
    </ConsoleShell>
  )
}
