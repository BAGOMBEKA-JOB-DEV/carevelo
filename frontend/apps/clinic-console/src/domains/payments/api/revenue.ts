import { attempt, readClient, type Attempt } from './http'
import {
  confirmedByMethodFrom,
  confirmedByServiceFrom,
  moneyFrom,
  revenueCaveatsFrom,
  type AggregatorConfirmedPayments,
} from './types'

/**
 * What the clinic's own aggregator confirmed, over a window of its own days.
 *
 * ------------------------------------------------------------------
 * THIS MODULE REPLACES AN ARGUMENT, AND THE ARGUMENT WAS RIGHT
 *
 * `RevenuePlaceholder` refused to draw this screen and said why: the only figures the
 * platform held were counts of ATTEMPTS, and summing those into "revenue" would have
 * asserted that every attempt reported as succeeded reached the clinic's account. That is
 * the one claim this architecture exists never to make, and a plausible, precise,
 * confidently-rendered number is exactly what a clinic owner would then make decisions on.
 *
 * ONE HALF OF THAT CHANGED. `GET /v1/revenue` reports what the aggregator CONFIRMED — a
 * COMPLETED that came back with a confirmation code, which `PaymentIntentResolver` refuses
 * to record unless the reported amount agrees with the amount we asked to collect. That is
 * a real observation about a real event, and it can honestly be counted.
 *
 * THE OTHER HALF DID NOT CHANGE AT ALL, and this module is built so that it cannot be
 * forgotten. Money never passes through Carevelo, there is no account here for it to pass
 * through, and nobody here can see the clinic's bank account. So:
 *
 *   - No function in this file is called `getRevenue`, and the type it returns is
 *     `AggregatorConfirmedPayments`. The URL says `revenue` because that is the question an
 *     owner arrives with; not one field, function or type in this domain does.
 *   - `caveats` is REQUIRED for the read to succeed. If the API stops sending
 *     `not_money_in_the_bank`, this returns a failure rather than a figure — see
 *     `revenueCaveatsFrom`. The caveat is the condition on which the number may be shown,
 *     not decoration around it.
 *   - Nothing here adds anything up. The headline pair is computed by the database over the
 *     whole window; the by-service breakdown is one cursor page of it. They are different
 *     quantities and this module never tries to reconcile them.
 *
 * ------------------------------------------------------------------
 * ADMINISTRATOR ONLY, ENFORCED BY THE API
 *
 * `PaymentIntentPolicy::reconcile()` admits `clinic_admin` and nobody else — deliberately
 * the same ability as the reconciliation view this sits beside, rather than a second one
 * free to drift from it. A clinic's whole takings are a commercial view of the business,
 * and a pharmacist or a front-desk clerk has no business in it even though both may take a
 * payment. A 403 here is the boundary working; the screen renders it as such.
 *
 * @see backend/app/Http/Controllers/Api/V1/RevenueController.php
 * @see backend/app/Http/Resources/V1/AggregatorConfirmedPaymentsResource.php
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */

/** What the endpoint returns before this module narrows it. See ./types.ts. */
type RevenuePayload = {
  data?: {
    confirmed_from?: unknown
    confirmed_to?: unknown
    clinic_timezone?: unknown
    aggregator_confirmed_count?: unknown
    aggregator_confirmed_total?: unknown
    by_method_recorded?: unknown
    by_service?: unknown
  }
  meta?: unknown
}

/**
 * The window an administrator asked for, or the clinic's current month.
 *
 * `from`, `to` AND `cursor` ARE PASSED THROUGH AS THEY ARRIVED AND NONE IS DEFAULTED HERE.
 * The API resolves the days in the CLINIC's own timezone from the tenant it already has
 * bound, and defaults to that clinic's current month when neither is given. A default
 * computed in this Node process would be the server's idea of the month, which in a UTC
 * container is the wrong month for a Kampala owner for three hours at each end of it —
 * exactly the boundary the backend spends a paragraph on `->utc()` getting right. Omitting
 * the parameters is how this asks for the clinic's own month.
 *
 * A malformed date gets the API's own 422 sentence rather than a guess made here about what
 * the administrator meant by it.
 */
export async function getAggregatorConfirmedPayments(
  from: string | undefined,
  to: string | undefined,
  cursor: string | undefined,
): Promise<Attempt<AggregatorConfirmedPayments>> {
  const result = await attempt(
    (async () => {
      const client = await readClient()

      return client.get<RevenuePayload>('/v1/revenue', {
        // `ApiClient` drops undefined and null rather than sending the string
        // "undefined", so an absent parameter is genuinely absent on the wire.
        query: { from, to, cursor },
      })
    })(),
  )

  if (!result.ok) {
    return result
  }

  const narrowed = narrow(result.value)

  if (narrowed === null) {
    /*
     * A 200 whose body could not be read as this response. Reported as a failure with no
     * status, which is what the screen renders as "we could not read the answer" — rather
     * than as an empty month, which is a figure and would be wrong.
     */
    return {
      ok: false,
      status: null,
      message: null,
    }
  }

  return { ok: true, value: narrowed }
}

/**
 * Turn the response into something this app can render, counting whatever it could not read.
 *
 * REFUSES THE WHOLE RESPONSE IN EXACTLY TWO CASES, and both are cases where a partial
 * render would be a lie rather than a gap: the window is not stated, or the caveats are not
 * there. Everything else degrades — an unreadable breakdown row is counted and reported,
 * and an unreadable total renders as "we cannot show this figure" beside a count that is
 * still true.
 *
 * The headline count and the headline amount are read INDEPENDENTLY. They come from one
 * database row over the whole window and either can be present without the other; a screen
 * that showed neither because one was malformed would be withholding a fact it holds.
 */
function narrow(payload: RevenuePayload): AggregatorConfirmedPayments | null {
  const data = payload.data

  if (typeof data !== 'object' || data === null) {
    return null
  }

  const confirmedFrom = data.confirmed_from
  const confirmedTo = data.confirmed_to
  const clinicTimezone = data.clinic_timezone

  /*
   * THE WINDOW IS NOT OPTIONAL. Every figure below is "in this window", and a figure whose
   * window is unknown is a figure that could be any month. There is no safe way to render
   * one, so the read fails instead.
   */
  if (typeof confirmedFrom !== 'string' || typeof confirmedTo !== 'string') {
    return null
  }

  const caveats = revenueCaveatsFrom(payload.meta)

  if (caveats === null) {
    return null
  }

  const methods = readRows(data.by_method_recorded, confirmedByMethodFrom)
  const services = readRows(data.by_service, confirmedByServiceFrom)
  const count = data.aggregator_confirmed_count

  return {
    confirmedFrom,
    confirmedTo,
    // Stated by the API so the dates and the figure beside them cannot silently disagree.
    // An absent timezone is rendered as unknown by the screen rather than assumed to be the
    // clinic's, because assuming it is how the disagreement starts.
    clinicTimezone: typeof clinicTimezone === 'string' ? clinicTimezone : '',
    count: typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : 0,
    total: moneyFrom(data.aggregator_confirmed_total),
    byMethodRecorded: methods.rows,
    byService: services.rows,
    unreadableMethodRows: methods.unreadable,
    unreadableServiceRows: services.unreadable,
    caveats,
    byServiceNextCursor: nextCursorFrom(payload.meta),
  }
}

/**
 * Narrow a list of breakdown rows, keeping a count of the ones that were refused.
 *
 * A REFUSED ROW IS COUNTED, NEVER DROPPED IN SILENCE — the same rule the reconciliation day
 * follows, for a sharper reason. A breakdown quietly missing one service reads as "that
 * service took nothing this month", which is not a missing row, it is a wrong fact about a
 * service line an owner may be about to stop offering.
 */
function readRows<T>(
  value: unknown,
  parse: (row: unknown) => T | null,
): { rows: readonly T[]; unreadable: number } {
  if (!Array.isArray(value)) {
    // Not an array at all is not the same as an empty one, but there is nothing to count:
    // the screen learns the breakdown is absent from the fact that it is empty, and the
    // headline figures beside it are unaffected and still true.
    return { rows: [], unreadable: 0 }
  }

  const rows: T[] = []
  let unreadable = 0

  for (const candidate of value) {
    const row = parse(candidate)

    if (row === null) {
      unreadable += 1

      continue
    }

    rows.push(row)
  }

  return { rows, unreadable }
}

/**
 * The cursor to the next page of services, or null on the last one.
 *
 * OPAQUE, AND NEVER CONSTRUCTED. It is handed back to the endpoint exactly as it arrived.
 * The backend is explicit that there is no `page` parameter and there will not be one —
 * `?page=2` is a 422, not a discarded parameter — because the grouped aggregate is keyed
 * on a service and an offset would repeat one service and skip another, producing a
 * breakdown whose rows are individually correct and whose sum is wrong.
 */
function nextCursorFrom(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) {
    return null
  }

  const cursor = (meta as Record<string, unknown>)['by_service_next_cursor']

  return typeof cursor === 'string' && cursor !== '' ? cursor : null
}
