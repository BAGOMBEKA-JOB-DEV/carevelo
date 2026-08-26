import { headers } from 'next/headers'
import { ApiClient, ApiError, type components } from '@carevelo/api-client'
import { requestHost } from '@/lib/tenant'

/**
 * Reading the patient's own dispense orders.
 *
 * WHY THIS LISTING EXISTS AT ALL, AND WHY IT DID NOT BEFORE. `DispenseOrderPolicy::viewOwn()`
 * has admitted a patient since it was written and nothing called it, so a patient could
 * open a dispense order only if they ALREADY held its identifier — and no endpoint they
 * were allowed to call ever handed them one. Paying for a dispensed order and choosing
 * collection or delivery therefore had no entry point in this portal: both opened from a
 * link the clinic sent, or not at all. `DispenseOrderController::index()` now branches on
 * `AuthorisesPatientReads`, which authorises and narrows in the same call, and this module
 * is the portal's half of that.
 *
 * THERE IS NO WRITE IN THIS FILE, AND THAT IS DELIBERATE RATHER THAN INCIDENTAL. The one
 * thing a patient may change about an order is how it is handed over, and that write lives
 * in the DELIVERY domain — see `domains/delivery/api/fulfilment.ts`, which explains at
 * length why the fulfilment decision is filed with the consent gate and the
 * controlled-item exclusion that govern it rather than with the order it hangs off. A
 * second writer here would put the address-disclosure rule one domain away from the screen
 * that depends on it.
 *
 * NO MEDICINE NAMES ARRIVE THROUGH THIS CALL, AND THE SERVER IS WHAT GUARANTEES IT. The
 * listing does not load the prescription relation, and `DispenseOrderResource` gates
 * `prescription`, `items` and `substitutions` behind `whenLoaded()` — so those keys are
 * ABSENT from a patient's page rather than blanked. The controller's own docblock adds the
 * one that needed an argument: `substitutions` is loaded for staff only, because
 * `SubstitutionResource` publishes `proposed_medicine_name`, and a medicine name in a LIST
 * is a medicine name on a screen read at a glance on a shared handset. The contents are one
 * deliberate tap away, on the order's own screen, behind `view`.
 *
 * EVERY TYPE COMES FROM THE GENERATED CONTRACT except the paging block, which the contract
 * does not describe yet — see `OrderPage` below, where that divergence is declared rather
 * than papered over.
 *
 * @see backend/app/Http/Controllers/Api/V1/DispenseOrderController.php — `index()`
 * @see backend/app/Http/Controllers/Api/V1/Concerns/AuthorisesPatientReads.php
 * @see backend/app/Policies/DispenseOrderPolicy.php — `viewOwn`
 */

export type DispenseOrder = components['schemas']['DispenseOrderResource']

/** The sixteen states an order moves through. The resource sends it as a plain string. */
export type DispenseOrderStatus = components['schemas']['DispenseOrderStatus']

/**
 * One page of a patient's own orders, newest first.
 *
 * ------------------------------------------------------------------------------------
 * A DIVERGENCE BETWEEN THE PUBLISHED CONTRACT AND THE RUNNING API, DECLARED RATHER THAN
 * PAPERED OVER — the same shape of note as `DeliveryMilestone` in the delivery domain.
 *
 * `docs/40-api/openapi.yaml` describes `GET /v1/dispense-orders` as the PHARMACY QUEUE and
 * nothing else: an offset paginator, whose `meta` carries `current_page`, `last_page` and
 * `total`. The patient branch of that same route pages by CURSOR — `cursorPaginate()` —
 * so the running API answers a patient with `meta.next_cursor` and `meta.prev_cursor`, and
 * with none of the offset fields. Coding to the generated type would compile and then read
 * `undefined` off every page, which renders as a list that can never be paged past its
 * first screen.
 *
 * So the paging block is declared here, at one site, and the cursor query parameter is sent
 * even though the operation publishes none of it. `cursorPaginate()` reads `?cursor=`
 * whether or not the specification says so.
 *
 * WHAT TO DO WITH THIS: describe the patient branch in `openapi.yaml` — its cursor meta and
 * its `cursor` parameter — regenerate the client, and then take this type from the
 * operation like everything else. It is a specification fix, not a code fix, and it is not
 * made here because this change does not own that file.
 * ------------------------------------------------------------------------------------
 */
export interface OrderPage {
  orders: DispenseOrder[]
  /** Opaque. Feed it back as `cursor`; never parse it, never construct one. */
  nextCursor: string | null
  prevCursor: string | null
}

/** What the patient branch actually puts in `meta`. See the note on `OrderPage`. */
interface CursorMeta {
  next_cursor: string | null
  prev_cursor: string | null
}

/**
 * The result shape every call in this file returns.
 *
 * A THROWN ERROR WOULD BE THE WRONG SHAPE HERE, for the reason `listPrescriptions()` gives
 * in the same words: these are read from Server Components, an exception in one becomes the
 * framework's error boundary, and — worse — an empty list and a failed request would look
 * identical on screen. `EmptyState` in packages/ui carries the argument: a patient will
 * read "you have no orders" as fact when the truth is that the API did not answer. So
 * failure is a value, the component renders it as a `Notice`, and the two stay apart.
 */
export type OrdersResult<T> =
  | ({ ok: true } & T)
  | {
      ok: false
      /**
       * A cross-tenant read answers 404, exactly as a genuinely missing record does.
       * Callers may turn this into `notFound()`; they must never turn it into "that
       * belongs to another clinic".
       */
      notFound: boolean
      /**
       * The API's OWN sentence, already humanised from RFC 9457 problem details — or
       * `null` when the request never reached the API at all.
       *
       * Null rather than a sentence invented here, because a string built in this module
       * cannot be translated: the catalogues are per-domain JSON and this file has no
       * locale. It also keeps the API's enumeration-safe and cross-tenant-safe phrasing
       * intact, which a paraphrase written here could quietly undo.
       */
      message: string | null
    }

/** The shape callers actually name, aliased so it reads in a type annotation. */
export type OrderListResult = OrdersResult<{ page: OrderPage }>

/** The API's ceiling lives in IndexDispenseOrderRequest; this is a screenful. */
const PER_PAGE = 20

/**
 * The authenticated client for this request.
 *
 * The session cookie and the clinic's Host header are both forwarded, because tenancy is
 * resolved from the host and authentication is a Sanctum cookie — a server-side call that
 * forgot either would be an anonymous request to no clinic in particular.
 *
 * BUILT PER CALL, NOT MEMOISED. `headers()` is request-scoped, and a client held across
 * requests would carry one patient's cookie into another patient's render.
 *
 * NOTE FOR WHOEVER CONSOLIDATES THIS. This is the THIRD copy of these twenty lines — the
 * prescriptions domain has one and the delivery domain has one — and `.dependency-cruiser.cjs`
 * already names `src/lib/api.ts` as the sanctioned home for a shared one. It is written out
 * again rather than imported sideways because a domain may not reach into another domain's
 * internals, and this is internal to all three. The move is a single deliberate change to
 * app-global code, which this one does not own; the CSRF handling in the delivery domain's
 * gateway is the part that must NOT be copied a fourth time, and is not copied here because
 * nothing in this file writes.
 */
async function patientApi(): Promise<ApiClient> {
  const requestHeaders = await headers()
  const host = (await requestHost()) ?? 'localhost'
  const cookie = requestHeaders.get('cookie')

  return new ApiClient({
    baseUrl: apiOrigin(host),
    headers: {
      host,
      /*
       * ORIGIN IS WHAT MAKES THE COOKIE COUNT, and its absence is why three of these
       * screens reported "your session has ended" to a patient who had just signed in.
       *
       * Sanctum decides a request is STATEFUL -- that it should authenticate by cookie
       * at all -- from the Origin or Referer host. Send the cookie without one and it
       * falls through to token authentication, finds no bearer token, and answers 401.
       * The session is perfectly valid; it is simply never consulted.
       *
       * Nothing catches this but a browser: typecheck, lint and the unit tests all pass,
       * and the visual baselines photographed the resulting error screen and matched it.
       */
      Origin: `http://${host}`,
      // Assigned only when present: exactOptionalPropertyTypes distinguishes "absent"
      // from "explicitly undefined", and a literal `undefined` here would be sent.
      ...(cookie === null ? {} : { cookie }),
    },
  })
}

/**
 * The API origin for this host.
 *
 * The CLINIC's subdomain is preserved and only the origin swapped. Tenancy comes from the
 * host, so an origin that lost the subdomain resolves the wrong clinic — or none at all,
 * which is a 404 on a page the patient reached from their own account.
 */
function apiOrigin(host: string): string {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    return `https://${host}`
  }

  const url = new URL(configured)
  url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`

  return url.origin
}

/**
 * The patient's own dispense orders, newest first.
 *
 * NO `patient_id` IS SENT. The endpoint narrows to the caller's own records through
 * `AuthorisesPatientReads`, and the `patient_id` filter the queue uses INTERSECTS with that
 * narrowing rather than replacing it — so passing somebody else's identifier returns
 * nothing rather than their orders. It is still not sent: a parameter that can only ever
 * subtract from what the caller may already see is at best noise, and at worst reads like
 * the thing that does the protecting. It is not; the trait is.
 *
 * NO `status` FILTER EITHER, AND THAT IS A SCREEN DECISION. A patient's order list is a
 * short personal history rather than a work queue, and the one thing they came to do —
 * find the order they were told about — is served by "newest first" and nothing else. A
 * status filter would publish the sixteen-case state machine to the surface least equipped
 * to read it.
 *
 * CURSOR, NEVER OFFSET. The pharmacy is pricing and dispensing into the same table while
 * the patient reads it, which is exactly the traffic under which an offset paginator
 * duplicates and skips rows — and a skipped row here is an order somebody never pays for.
 */
export async function listDispenseOrders(
  options: { cursor?: string | undefined } = {},
): Promise<OrderListResult> {
  try {
    const api = await patientApi()

    const body = await api.get<{ data: DispenseOrder[]; meta: CursorMeta }>('/v1/dispense-orders', {
      query: {
        per_page: PER_PAGE,
        // Dropped by the client when undefined rather than sent as the string
        // "undefined", which would be a 422 on the first page.
        cursor: options.cursor,
      },
    })

    return {
      ok: true,
      page: {
        orders: body.data,
        // `?? null` rather than trusting the field to be there: this block is not in the
        // published contract (see `OrderPage`), so it is read defensively at the one place
        // it is read at all. A missing cursor is "no further page", which is the safe
        // reading — it stops a pager, it never invents one.
        nextCursor: body.meta?.next_cursor ?? null,
        prevCursor: body.meta?.prev_cursor ?? null,
      },
    }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Every failure, as a flag and — where the API gave one — its own sentence.
 *
 * `ApiError.message` is already `humanise()`d from RFC 9457 problem details, so the API's
 * wording reaches the patient rather than a paraphrase invented here. That matters beyond
 * tidiness: the backend phrases refusals so that they never confirm a record exists in
 * another clinic, and a frontend that rewrote them could undo that without noticing.
 */
function failure(error: unknown): { ok: false; notFound: boolean; message: string | null } {
  if (error instanceof ApiError) {
    return { ok: false, notFound: error.status === 404, message: error.message }
  }

  // Not an ApiError: the request never got an answer — DNS, a dropped connection, a
  // timeout. There is nothing the API said to pass on, so the component says it in the
  // patient's language instead.
  return { ok: false, notFound: false, message: null }
}
