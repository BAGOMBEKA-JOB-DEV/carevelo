import { attempt, getText, readClient, type Attempt, type TextResponse } from './http'
import { reconciliationRowFrom, type ReconciliationDay, type ReconciliationRow } from './types'

/**
 * The daily reconciliation read, and the CSV of the same records.
 *
 * CAREVELO RECONCILES RECORDS, NOT MONEY, and that sentence is a constraint on this module
 * rather than a slogan attached to it. The funds never pass through the platform: the
 * patient pays the aggregator and the aggregator pays the clinic's own account direct. So
 * there is no total collected here, no reconciled figure and no variance — each would be an
 * assertion about money nobody here can see, and a clinic that balanced its books against
 * an invented number would be reconciling against fiction.
 *
 * What this offers instead is every attempt the platform recorded, each carrying the
 * aggregator's own reference, with a flag on the ones that do not look right — so an
 * administrator can open their own aggregator dashboard with a specific reference in hand.
 * That is the most useful thing that can honestly be offered.
 *
 * ADMINISTRATOR ONLY, ENFORCED BY THE API. `PaymentIntentPolicy::reconcile()` admits
 * `clinic_admin` and nobody else, so a front-desk clerk or a pharmacist gets 403 here. The
 * screen renders that as a boundary working rather than as a fault; see
 * `ReconciliationScreen`.
 *
 * @see backend/app/Http/Controllers/Api/V1/ReconciliationController.php
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */

/** What the endpoint returns before this module narrows the rows. See ./types.ts. */
type ReconciliationPayload = {
  data?: { date?: unknown; intents?: unknown }
  meta?: { total?: unknown; flagged?: unknown; note?: unknown }
}

/**
 * One clinic day of payment records.
 *
 * `date` IS PASSED THROUGH AS THE CALLER GAVE IT and never defaulted here. The API resolves
 * "today" in the CLINIC's own timezone, from the tenant it already has bound; a default
 * computed in this process would be the server's idea of today, which in a UTC container is
 * the wrong day for a Kampala administrator reconciling the evening's takings. Omitting the
 * parameter is how this asks for the clinic's today.
 *
 * @see backend/app/Http/Controllers/Api/V1/ReconciliationController.php — `$this->timezone($request)`
 */
export async function getReconciliation(date: string | undefined): Promise<Attempt<ReconciliationDay>> {
  const result = await attempt(
    (async () => {
      const client = await readClient()

      return client.get<ReconciliationPayload>('/v1/reconciliation', {
        query: date === undefined ? {} : { date },
      })
    })(),
  )

  if (!result.ok) {
    return result
  }

  return { ok: true, value: narrow(result.value, date) }
}

/**
 * Turn the response into rows this app can render, counting whatever it could not read.
 *
 * A REFUSED ROW IS COUNTED, NEVER DROPPED IN SILENCE. A reconciliation screen quietly
 * showing eleven of twelve records is worse than one showing none: the administrator would
 * balance the clinic's books against it and never learn that a line was missing. The count
 * travels to the screen, which says so out loud.
 */
function narrow(payload: ReconciliationPayload, requested: string | undefined): ReconciliationDay {
  const raw = Array.isArray(payload.data?.intents) ? payload.data.intents : []
  const rows: ReconciliationRow[] = []
  let unreadable = 0

  for (const candidate of raw) {
    const row = reconciliationRowFrom(candidate)

    if (row === null) {
      unreadable += 1

      continue
    }

    rows.push(row)
  }

  return {
    // The API echoes the day it actually resolved, which is the clinic's own day and may
    // differ from anything this process would have computed. Its answer wins; the
    // requested value is only a fallback for a response that omitted it.
    date: typeof payload.data?.date === 'string' ? payload.data.date : requested ?? '',
    rows,
    meta: {
      total: typeof payload.meta?.total === 'number' ? payload.meta.total : rows.length,
      flagged:
        typeof payload.meta?.flagged === 'number'
          ? payload.meta.flagged
          : rows.filter((row) => row.flags.length > 0).length,
      note: typeof payload.meta?.note === 'string' ? payload.meta.note : '',
    },
    unreadable,
  }
}

/**
 * The same records as CSV, for the clinic's own books.
 *
 * Every line carries the aggregator's own reference so an administrator can match each row
 * against their aggregator dashboard unaided. The backend's column names say whose claim
 * each value is — `requested_amount_minor` rather than `amount`, because it is what we asked
 * the aggregator to collect and not what anyone confirms landed; `status_reported` rather
 * than `status`, because it is the aggregator's account of the attempt. There is no total
 * column and there must never be one.
 *
 * The range is capped at 92 days by the API. A wider request comes back 422 with a sentence
 * saying so, which is passed through rather than paraphrased.
 */
export function exportReconciliation(from: string, to: string): Promise<TextResponse> {
  return getText('/v1/reconciliation/export', { from, to })
}
