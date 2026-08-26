import type { Metadata } from 'next'
import {
  AggregatorConfirmedScreen,
  SectionNav,
  getAggregatorConfirmedPayments,
} from '@/domains/payments'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * What the clinic's own aggregator confirmed, over a window of the clinic's own days.
 *
 * THE WINDOW IS PASSED THROUGH UNINTERPRETED AND IS NEVER DEFAULTED HERE. The API resolves
 * the days in the CLINIC's timezone from the tenant it already has bound, and answers the
 * clinic's own current month when neither date is given. A default computed in this Node
 * process would be the server's idea of the month, which in a UTC container is the wrong
 * month for a Kampala owner for three hours at each end of it — the exact boundary the
 * backend spends a paragraph getting right. Absent parameters are how this asks for the
 * clinic's month, and a malformed one gets the API's own validation sentence rather than a
 * guess made here about what it meant.
 *
 * `cursor` IS OPAQUE AND IS HANDED BACK EXACTLY AS IT ARRIVED. It is produced only by this
 * endpoint, which has no `page` parameter and will not get one: the breakdown is a grouped
 * aggregate, a late confirmation can create a group between two requests, and an offset
 * would repeat one service and skip another.
 *
 * A FAILED READ IS NOT AN ERROR PAGE. A 403 means the reader is not a clinic administrator,
 * which is the boundary working exactly as designed — the same ability as reconciliation,
 * deliberately, rather than a second one free to drift from it. The screen renders that as
 * information. Throwing would replace a correct refusal with the framework's error boundary
 * and produce a support call.
 */
export const metadata: Metadata = { title: 'Confirmed payments' }

export default async function ConfirmedPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; cursor?: string }>
}) {
  const params = await searchParams
  const result = await getAggregatorConfirmedPayments(params.from, params.to, params.cursor)

  return (
    <ConsoleShell title="Payments" active="payments">
      <SectionNav active="confirmed" />
      <AggregatorConfirmedScreen
        result={result}
        from={params.from}
        to={params.to}
        selfPath="/payments/confirmed"
        reconciliationPath="/payments/reconciliation"
      />
    </ConsoleShell>
  )
}
