import { ApiError } from '@carevelo/api-client'
import { readClient, writeClient } from '@/domains/identity'
import { listTenants } from './tenants'
import type { CollectionHandoff, PlanBody, Subscription } from '../model/subscription'
import type { PlatformProblem, Tenant, TenantQuery } from '../model/types'

/**
 * Carevelo's own revenue: what each clinic agreed to pay, and whether it has.
 *
 * ==================================================================
 * THIS IS THE ONE PLACE IN THE PRODUCT WHERE CAREVELO IS THE MERCHANT
 * ==================================================================
 *
 * Everywhere else, money moves patient → aggregator → the clinic's own account, and
 * Carevelo is not in the path. ADR-0003 is blunt about why: custody would trigger the NPS
 * Act 2020 PSP and e-money-issuer categories at UGX 250m–10bn of capital, and "a design
 * that drifted into custody would not inconvenience the company; it would end it."
 *
 * A clinic's subscription to the software is the exception the ADR names and bounds, and it
 * is a supplier collecting its own fee rather than custody of anybody's money. The
 * separation is enforced on the API side by four things — platform credentials that cannot
 * be built from a tenant row, a table no tenant session can read or write, a resolver
 * sharing no code with the patient one, and a notification endpoint that takes no tenant.
 *
 * THIS MODULE ADDS NOTHING TO THAT AND MUST NEVER TRY TO. It reads three platform endpoints
 * and posts to one. There is no patient here, no payment intent, no aggregator account and
 * no clinic-side anything — and no function below takes a tenant from a form: every id
 * passed to these calls is one the register itself produced.
 *
 * ==================================================================
 * THE GAP THAT SHAPES THE REGISTER SCREEN, STATED HERE BECAUSE IT IS THIS FILE'S PROBLEM
 * ==================================================================
 *
 * `GET /v1/platform/tenants` returns `PlatformTenantResource`, which carries `status`,
 * `is_suspended` and `trial_ends_at` — AND NO `plan`, NO `price` AND NO
 * `current_period_ends_at`. The commercial fields live on `PlatformSubscriptionResource`,
 * which is reachable only one clinic at a time.
 *
 * So there is no way to ask "which clinics are due?" in one request, and
 * `readSubscriptionRegister` below reads the register page and then reads each clinic on it.
 * That is a fan-out and it is bounded on purpose: it costs one HTTP call per clinic on the
 * page and it cannot answer anything about the clinics on the NEXT page. The screen says
 * both of those in words rather than presenting a page as though it were the register — the
 * same discipline `listAllTenants` follows with its `complete` flag, and for the same
 * reason: a truncated list passed off as a whole one is how a clinic nobody chased goes
 * unnoticed.
 *
 * WHAT WOULD CLOSE IT: `plan` and `current_period_ends_at` on `PlatformTenantResource`, or
 * a `GET /v1/platform/subscriptions` index. Either is a small change on a resource that
 * already reads the tenants table. It is reported in the handover rather than worked around
 * more cleverly here, because every cleverer version of this is still N requests.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see backend/app/Http/Controllers/Api/Platform/PlatformSubscriptionController.php
 */

/**
 * One clinic's subscription: plan, agreed price, both dates, status and recent charges.
 *
 * READABLE BY BOTH PLATFORM ROLES. The controller authorises with `viewAny` — the same
 * ability as the register itself — because "is this clinic paid up?" is a metadata question
 * support fields all day. Only the two writes below are `platform_admin`'s.
 */
export async function getSubscription(id: string): Promise<Subscription | null> {
  try {
    const client = await readClient()
    const response = await client.get<{ data: Subscription }>(
      `/v1/platform/tenants/${encodeURIComponent(id)}/subscription`,
    )

    return response.data
  } catch (error) {
    /*
     * NULL FOR 404 AND FOR 403 ALIKE, so a caller cannot distinguish "this clinic is not
     * there" from "you may not read it" and accidentally build a screen that does. On this
     * surface both are about Carevelo's own permissions rather than about a clinic
     * discovering another clinic's records, but the register's own reads make the same
     * collapse and a second convention here would be one to remember.
     */
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null
    }

    throw error
  }
}

/** One clinic on the billing register: the row, plus what could be read about its money. */
export type SubscriptionRow = {
  readonly tenant: Tenant
  /**
   * Null when the subscription read failed for this clinic alone.
   *
   * NOT COLLAPSED INTO AN EMPTY SUBSCRIPTION, and this is the whole reason the field is
   * nullable rather than defaulted. A clinic whose subscription could not be read would
   * otherwise render identically to a clinic with no plan agreed — and one of those is
   * "nothing to do here" while the other is "this screen does not know". On a register whose
   * job is to say who to chase, those must not look the same.
   */
  readonly subscription: Subscription | null
}

export type SubscriptionRegister = {
  readonly rows: readonly SubscriptionRow[]
  /** The cursor for the next page of the register, or null. Opaque; never constructed. */
  readonly nextCursor: string | null
  /** The cursor this page was reached by, so the pager can offer a way back. */
  readonly cursor: string | undefined
  /**
   * How many clinics on this page could not have their subscription read.
   *
   * Surfaced rather than swallowed. A billing register quietly showing eleven of twelve
   * clinics is worse than one showing none: somebody works through the list, reaches the
   * end, and believes they are finished.
   */
  readonly unreadable: number
}

/**
 * A page of the register with each clinic's subscription beside it.
 *
 * ONE HTTP READ PER CLINIC, WHICH IS WHY THE PAGE SIZE IS AN ARGUMENT AND NOT A DEFAULT.
 * See the header: the contract has no index carrying the commercial fields, so the page
 * size IS the request count. It is set by the caller, stated on the screen, and kept well
 * below the API's own maximum of 100 — a register page is a screenful somebody works
 * through, not a bulk export.
 *
 * `Promise.all` RATHER THAN A LOOP. The reads are independent and the alternative is a page
 * that takes as long as its slowest clinic times its length. They are still N requests and
 * that is still the thing to fix in the API.
 *
 * ONE CLINIC'S FAILURE DOES NOT TAKE THE PAGE DOWN. `getSubscription` returns null on 403
 * and 404, and anything else is caught per clinic below — so a register of forty clinics
 * still renders when one of them cannot be read, with that one visibly marked. A
 * `Promise.all` that rejected would replace an operator's whole working list with an error
 * boundary because of a single row.
 */
export async function readSubscriptionRegister(
  query: TenantQuery,
  perPage: number,
): Promise<SubscriptionRegister> {
  const page = await listTenants({ ...query, per_page: perPage })

  const rows = await Promise.all(
    page.data.map(async (tenant): Promise<SubscriptionRow> => {
      try {
        return { tenant, subscription: await getSubscription(tenant.id) }
      } catch (error) {
        /*
         * Server-side only, and without the clinic's own details beyond the id the register
         * already published to this operator. A commercial fact about a named company
         * should not accumulate in a log because a socket closed.
         */
        console.error('[platform] a subscription read did not complete', tenant.id, error)

        return { tenant, subscription: null }
      }
    }),
  )

  return {
    rows,
    nextCursor: page.meta.next_cursor,
    cursor: query.cursor,
    unreadable: rows.filter((row) => row.subscription === null).length,
  }
}

/** What a write attempt did, with no exception left for the caller to interpret. */
export type SubscriptionOutcome =
  | { kind: 'done'; subscription: Subscription }
  | { kind: 'problem'; problem: PlatformProblem; message: string | null; fields: Record<string, string> }

/**
 * Record the plan and the price a clinic agreed.
 *
 * COLLECTS NOTHING. Recording a commercial agreement and asking Pesapal for money are two
 * different acts and two different endpoints, and the backend keeps them apart for a reason
 * this app has to keep too: a support operator correcting a typo in a price must not
 * thereby charge a clinic. There is no "save and collect" anywhere in this domain.
 *
 * BOTH FIELDS TOGETHER, ALWAYS. `UpdateSubscriptionRequest` requires them as a pair — a
 * tier alone would have to imply a price from a list, and the first bespoke deal makes that
 * list a lie; a price alone leaves a clinic paying for something nobody can name.
 *
 * THE PRICE IS WHOLE SHILLINGS ON THE WIRE and minor units everywhere else. That asymmetry
 * is the backend's and it is deliberate — "nobody in Uganda quotes cents and a platform
 * operator typing a monthly fee should type 250000" — so the conversion happens once, in
 * the one place a human types the number, which is inside the API. Nothing in this app
 * multiplies or divides a price, and the form that feeds this deliberately does not
 * pre-fill the box with a converted value.
 */
export async function setSubscriptionPlan(id: string, body: PlanBody): Promise<SubscriptionOutcome> {
  try {
    const client = await writeClient()
    const response = await client.put<{ data: Subscription }>(
      `/v1/platform/tenants/${encodeURIComponent(id)}/subscription`,
      body,
    )

    return { kind: 'done', subscription: response.data }
  } catch (error) {
    return { kind: 'problem', ...diagnose(error) }
  }
}

export type CollectionOutcome =
  | { kind: 'done'; handoff: CollectionHandoff }
  | { kind: 'problem'; problem: PlatformProblem; message: string | null }

/**
 * Authorise the recurring collection at Pesapal.
 *
 * THE ONLY CALL IN THIS PRODUCT THAT COLLECTS INTO CAREVELO'S OWN ACCOUNT. It moves no
 * money by itself: it records the charge expected and returns the hosted page the clinic's
 * administrator pays on. The clinic's own aggregator account is unreachable from the
 * endpoint behind it — `SubscriptionBilling` takes platform credentials from configuration
 * and has no `AggregatorAccount` in scope.
 *
 * A SECOND COLLECTION IS REFUSED BY THE API, and the refusal is worth understanding rather
 * than routing around: two recurring mandates at Pesapal means a clinic pays twice a month
 * until the CLINIC notices. The stated cost is that changing a plan mid-subscription needs
 * the old mandate cancelled at Pesapal by hand. The API's own sentence explains it and is
 * passed through unchanged.
 *
 * 503 IS THE HONEST ANSWER ON AN UNCONFIGURED DEPLOYMENT and is not smoothed over here.
 * `PlatformMerchant` has no credentials in local or test environments, deliberately, so
 * that the suspension sweep and the notification endpoint behave sanely on a machine with
 * no Pesapal account. It must never silently fall back to collecting through a clinic's.
 */
export async function startSubscriptionCollection(id: string): Promise<CollectionOutcome> {
  try {
    const client = await writeClient()
    const response = await client.post<{ data: CollectionHandoff }>(
      `/v1/platform/tenants/${encodeURIComponent(id)}/subscription/collect`,
    )

    return { kind: 'done', handoff: response.data }
  } catch (error) {
    const { problem, message } = diagnose(error)

    return { kind: 'problem', problem, message }
  }
}

/**
 * Which of the things that can go wrong went wrong.
 *
 * A COPY OF `api/tenants.ts`'s FUNCTION OF THE SAME NAME, WITH ONE ARM ADDED, AND THE
 * DUPLICATION IS DELIBERATE RATHER THAN OVERLOOKED. Sharing it would mean exporting it from
 * that module, which would make an internal error-mapping detail part of the surface two
 * screens depend on — and the two are already diverging: nothing on the tenant register can
 * answer 503, and a `billing_unavailable` arm over there would describe a state those
 * endpoints cannot be in. When a third caller appears, both belong in one place; two is not
 * yet a pattern.
 *
 * 503 IS `failed` AND CARRIES THE API'S OWN SENTENCE. There is no `unconfigured` code,
 * because an operator does not need to be taught the difference between a deployment with
 * no merchant account and one whose merchant account is unreachable — both mean "nothing
 * was charged and nothing was recorded", which is what the message says.
 *
 * NOTHING IS REWRITTEN. `ApiError` has already put RFC 9457 problem details through
 * `humanise()`; the API is the authority on why it refused, and a paraphrase loses the part
 * the operator can act on.
 */
function diagnose(error: unknown): {
  problem: PlatformProblem
  message: string | null
  fields: Record<string, string>
} {
  if (!(error instanceof ApiError)) {
    return { problem: 'failed', message: null, fields: {} }
  }

  if (error.status === 403) {
    return { problem: 'refused', message: error.message, fields: {} }
  }

  if (error.status === 404) {
    return { problem: 'not_found', message: error.message, fields: {} }
  }

  if (error.status === 422) {
    return { problem: 'invalid', message: error.message, fields: error.fieldErrors }
  }

  return { problem: 'failed', message: error.message, fields: {} }
}
