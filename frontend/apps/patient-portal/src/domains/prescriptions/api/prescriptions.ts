import { headers } from 'next/headers'
import { ApiClient, ApiError, type components, type operations } from '@carevelo/api-client'
import { requestHost } from '@/lib/tenant'

/**
 * Reading the patient's own prescriptions.
 *
 * THERE IS NO WRITE IN THIS FILE, AND THAT IS THE POINT. `PrescriptionPolicy::update()`
 * and `::delete()` both return `false` unconditionally — not for a patient, not for the
 * clinician who wrote it, not for a clinic administrator — and `routes/api.php` registers
 * `prescriptions` with `only(['index', 'store', 'show'])`, so there is no PUT and no PATCH
 * to call. A correction is a cancel and a replacement, both of which are clinical acts on
 * the clinic's own surface. Nothing here should ever grow an edit, and the components in
 * this domain render no edit affordance for the same reason.
 *
 * EVERY TYPE COMES FROM THE GENERATED CONTRACT. `Prescription` and `PrescriptionItem` are
 * aliases of the schema, never re-descriptions of it; the day the API adds a field, this
 * file sees it without anybody editing a second copy.
 *
 * THE READS ARE AUDITED SERVER-SIDE. PrescriptionController records `prescription.read`
 * and `prescription.list_read` on every call — "who looked at my records?" is only
 * answerable because every look is recorded — so nothing here should batch, cache or
 * dedupe requests in a way that makes a screen's reads stop corresponding to a person
 * actually looking at it.
 *
 * @see backend/app/Http/Controllers/Api/V1/PrescriptionController.php
 * @see backend/app/Policies/PrescriptionPolicy.php
 */

export type Prescription = components['schemas']['PrescriptionResource']
export type PrescriptionItem = components['schemas']['PrescriptionItemResource']

/** `issued` | `cancelled` | `superseded`. The resource sends it as a plain string. */
export type PrescriptionStatus = components['schemas']['PrescriptionStatus']

/**
 * The cursor block, taken from the operation rather than described again.
 *
 * CURSOR, NOT OFFSET, and the backend's comment says why in terms that matter here: a
 * list paged by offset while new rows arrive shows duplicates and SKIPS rows, "and a
 * skipped row here is a prescription nobody dispenses". So this domain never builds a
 * `page=` parameter, and the components below navigate by the opaque cursor the API hands
 * back and nothing else.
 */
type IndexResponse =
  operations['v1.prescriptions.index']['responses'][200]['content']['application/json']

export interface PrescriptionPage {
  prescriptions: Prescription[]
  /** Opaque. Feed it back as `cursor`; never parse it, never construct one. */
  nextCursor: string | null
  prevCursor: string | null
}

/**
 * The result shape every call in this file returns.
 *
 * A THROWN ERROR WOULD BE THE WRONG SHAPE HERE. These are read from Server Components,
 * and an exception in one becomes the framework's error boundary — a blank screen where a
 * patient expected their medicines. Worse, an empty list and a failed request would look
 * identical, and `EmptyState` in packages/ui carries a comment about exactly that: "a
 * patient will read 'you have no prescriptions' as fact when the truth is that the API did
 * not answer." So failure is a value, the components render it as a `Notice`, and the two
 * cases stay distinguishable.
 */
export type PrescriptionsResult<T> =
  | ({ ok: true } & T)
  | {
      ok: false
      /**
       * A cross-tenant read answers 404, exactly as a genuinely missing record does —
       * see docs and PrescriptionController's use of findOrFail. Callers may turn this
       * into `notFound()`; they must never turn it into "that belongs to another clinic".
       */
      notFound: boolean
      /**
       * The API's OWN sentence, already humanised from RFC 9457 problem details — or
       * `null` when the request never reached the API at all.
       *
       * Null rather than a sentence invented here, because a string built in this file
       * cannot be translated: the message catalogues are per-domain JSON and this module
       * has no locale. A component that gets `null` renders its own catalogue's wording;
       * one that gets a sentence passes it through unchanged, which is what keeps the
       * API's enumeration-safe and cross-tenant-safe phrasing intact.
       */
      message: string | null
    }

/**
 * The two shapes callers actually name.
 *
 * Aliased rather than left as a generic at every call site, because these are what the
 * components take as props and what the route layer hands them — a name that reads in a
 * type annotation is worth more than the two words of generality it costs.
 */
export type PrescriptionListResult = PrescriptionsResult<{ page: PrescriptionPage }>
export type PrescriptionResult = PrescriptionsResult<{ prescription: Prescription }>

/** The API's default and ceiling live in IndexPrescriptionRequest; this is a screenful. */
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
 * NOTE FOR WHOEVER CONSOLIDATES THIS. The delivery domain has the same twenty lines, and
 * `.dependency-cruiser.cjs` already names `src/lib/api.ts` as the sanctioned home for a
 * shared one. It is not there yet only because `src/lib/` is app-global and several
 * domains are being written in parallel; moving it is a small, deliberate change that
 * should happen once, rather than two agents racing to create the same file.
 */
async function patientApi(): Promise<ApiClient> {
  const requestHeaders = await headers()
  const host = (await requestHost()) ?? 'localhost'
  const cookie = requestHeaders.get('cookie')

  return new ApiClient({
    baseUrl: apiOrigin(host),
    headers: {
      host,
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
 * The patient's own prescriptions, newest first.
 *
 * NO `patient_id` IS SENT. The endpoint narrows to the caller's own records through
 * `AuthorisesPatientReads`, and passing an id would at best be redundant and at worst be
 * the shape of an attempt to read somebody else's — which the backend intersects away to
 * nothing rather than honouring. There is nothing for this function to scope.
 */
export async function listPrescriptions(
  options: { cursor?: string | undefined } = {},
): Promise<PrescriptionListResult> {
  try {
    const api = await patientApi()

    const body = await api.get<{ data: Prescription[]; meta: IndexResponse['meta'] }>(
      '/v1/prescriptions',
      {
        query: {
          per_page: PER_PAGE,
          // Dropped by the client when undefined rather than sent as the string
          // "undefined", which would be a 422 on the first page.
          cursor: options.cursor,
        },
      },
    )

    return {
      ok: true,
      page: {
        prescriptions: body.data,
        nextCursor: body.meta.next_cursor,
        prevCursor: body.meta.prev_cursor,
      },
    }
  } catch (error) {
    return failure(error)
  }
}

/**
 * One prescription, with its items.
 *
 * `show` loads the items, so a caller never has to fetch them separately — and must not,
 * because each read is a separate audited disclosure of clinical content.
 */
export async function getPrescription(id: string): Promise<PrescriptionResult> {
  try {
    const api = await patientApi()
    const body = await api.get<{ data: Prescription }>(`/v1/prescriptions/${encodeURIComponent(id)}`)

    return { ok: true, prescription: body.data }
  } catch (error) {
    return failure(error)
  }
}

/**
 * What `GET /v1/prescriptions/{id}/document` can answer.
 *
 * `rendering` IS A REAL ANSWER, NOT AN ERROR. The document is produced by a queued job;
 * when the file does not exist yet the endpoint dispatches the render and returns 202 with
 * `{"status":"rendering"}`. A caller that treated 202 as a failure would tell a patient
 * their prescription was unavailable when it was thirty seconds away.
 */
type DocumentPayload =
  operations['v1.prescriptions.document']['responses'][200]['content']['application/json']['data']

export type DocumentLink =
  | ({ status: 'ready' } & DocumentPayload)
  | { status: 'rendering' }
  | { status: 'unavailable'; notFound: boolean; message: string | null }

/**
 * A short-lived signed link to the written prescription.
 *
 * WHY THIS IS FETCHED AT THE MOMENT OF PRESSING AND NEVER RENDERED INTO A PAGE. The URL is
 * a bearer credential for special-category health data: whoever holds it reads the
 * document, with no further authentication. `PrescriptionDocuments::LINK_TTL_SECONDS` is
 * 300 — "short enough that a link forwarded into a family WhatsApp group is already dead
 * when it arrives" — and that guarantee only holds if the clock starts when the patient
 * asks. A link baked into the HTML starts expiring while the page is still being read, and
 * sits in every cache and screenshot of that page for the rest of its life.
 *
 * The authorisation happens on the API before any URL exists, so this is also the only way
 * to reach the bytes: there is no public path and none worth guessing.
 */
export async function prescriptionDocumentLink(id: string): Promise<DocumentLink> {
  try {
    const api = await patientApi()

    const body = await api.get<{ data: DocumentPayload | { status: 'rendering' } }>(
      `/v1/prescriptions/${encodeURIComponent(id)}/document`,
    )

    // 202 and 200 are both `ok`, so the body is what distinguishes them. The rendering
    // response carries a literal `status`; the ready one carries a `url`.
    if ('url' in body.data) {
      return { status: 'ready', ...body.data }
    }

    return { status: 'rendering' }
  } catch (error) {
    const result = failure(error)

    return { status: 'unavailable', notFound: result.notFound, message: result.message }
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
