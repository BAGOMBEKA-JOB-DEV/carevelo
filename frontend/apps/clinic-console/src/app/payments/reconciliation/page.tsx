import type { Metadata } from 'next'
import { ReconciliationScreen, SectionNav, getReconciliation } from '@/domains/payments'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The clinic administrator's daily reconciliation.
 *
 * `date` IS PASSED THROUGH UNINTERPRETED AND IS NEVER DEFAULTED HERE. The API resolves the
 * day in the CLINIC's timezone, from the tenant it already has bound; a default computed in
 * this Node process would be the server's idea of today, which in a UTC container is the
 * wrong day for a Kampala administrator reconciling the evening's takings. An absent
 * parameter is how this asks for the clinic's today, and it is also how a malformed one gets
 * the API's own validation sentence rather than a guess made here about what it meant.
 *
 * A FAILED READ IS NOT AN ERROR PAGE. `getReconciliation` returns an `Attempt`; a 403 means
 * the reader is not a clinic administrator, which is the boundary working exactly as
 * designed. The screen renders that as information. Throwing would replace a correct
 * refusal with the framework's error boundary and produce a support call.
 */
export const metadata: Metadata = { title: 'Reconciliation' }

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; flagged?: string; exportProblem?: string }>
}) {
  const params = await searchParams
  const result = await getReconciliation(params.date)

  return (
    <ConsoleShell title="Payments" active="payments">
      <SectionNav active="reconciliation" />
      <ReconciliationScreen
        result={result}
        date={params.date}
        // Compared against the literal '1': `Boolean('0')` is `true`, and a stale link must
        // not silently hide every unflagged record on a reconciliation screen.
        flaggedOnly={params.flagged === '1'}
        selfPath="/payments/reconciliation"
        exportPath="/payments/reconciliation/export"
        exportProblem={params.exportProblem}
      />
    </ConsoleShell>
  )
}
