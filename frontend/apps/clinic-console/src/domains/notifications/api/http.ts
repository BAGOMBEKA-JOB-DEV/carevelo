import { cookies, headers } from 'next/headers'
import { ApiClient, ApiError } from '@carevelo/api-client'

/**
 * How the notifications domain reaches the Carevelo API.
 *
 * READ-ONLY, AND THAT IS THE INTERESTING PART. There is no `writeClient()` here and there
 * must not be one, because this domain has nothing to write: the API exposes three GETs and
 * no send endpoint at all. Every message leaves the platform through the backend's
 * `Notifier`, rendered from a closed template catalogue, because a free-text send API is a
 * free-text disclosure API — SMS transits the mobile operator and lands on a lock screen
 * anyone standing nearby can read. A `writeClient()` sitting unused in this file would
 * describe a capability that does not exist, which is the sort of thing somebody later
 * mistakes for one that does.
 *
 * The plumbing itself is the same three problems the payments domain solves and solves the
 * same way: `credentials: 'include'` does nothing in a Node process so the session cookie is
 * copied by hand; Sanctum ignores a session unless `Origin` is in its stateful list; and
 * tenancy is the host, so the clinic's subdomain has to survive the swap to the API origin.
 *
 * DELIBERATE DUPLICATION, NAMED RATHER THAN HIDDEN. `src/domains/payments/api/http.ts` and
 * `src/domains/audit/api/http.ts` carry versions of this. A transport is not a public
 * surface, so reaching into another domain for it is a build failure — correctly — and the
 * honest home is `src/lib/api.ts`, which `.dependency-cruiser.cjs` already names as the one
 * module allowed to hold HTTP plumbing and which does not exist in this app yet. Promoting
 * it there is app-global work more than one change has to agree on; it is in the handover.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 * @see docs/40-api/authentication-and-sessions.md
 */

/** The API origin for this request, with the CLINIC'S SUBDOMAIN PRESERVED. */
async function apiOrigin(host: string): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    return `https://${host}`
  }

  // The port is stripped before the subdomain is read: `kira.localhost:3001` split on '.'
  // would otherwise carry the port into the new host.
  const url = new URL(configured)
  url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`

  return url.origin
}

/**
 * The host this request was really made to.
 *
 * `x-forwarded-host` first: the plain `host` header degrades to the bare origin on the
 * render Next performs after a Server Action redirect, taking the clinic's subdomain — the
 * entire basis of tenancy — with it. Nothing in this domain redirects today, and it is
 * written this way anyway so the first thing that does is not a mystery 404.
 */
async function currentHost(): Promise<string> {
  const requestHeaders = await headers()

  return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost'
}

async function consoleOrigin(host: string): Promise<string> {
  const requestHeaders = await headers()
  const forwarded = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const scheme = forwarded ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')

  return `${scheme}://${host}`
}

async function cookieHeader(): Promise<string> {
  const jar = await cookies()

  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

/**
 * A client for READING, carrying this member of staff's session.
 *
 * `Accept-Language: en` is pinned because only the patient portal is bilingual. A clinic
 * whose browser advertises Luganda should not get a Luganda validation message dropped into
 * an otherwise-English console.
 */
export async function readClient(): Promise<ApiClient> {
  const host = await currentHost()

  return new ApiClient({
    baseUrl: await apiOrigin(host),
    headers: {
      host,
      Origin: await consoleOrigin(host),
      Cookie: await cookieHeader(),
      'Accept-Language': 'en',
    },
  })
}

/**
 * The result of a read that is allowed to fail without taking the page down.
 *
 * `status` is carried because 403 has to be rendered differently rather than merely
 * reported: the send history and the template catalogue are clinic-administrator screens,
 * and a pharmacist who lands on one is not experiencing a fault. A red box saying "You do
 * not have permission to do that." beside an empty table reads as broken software and
 * produces a support call about a boundary that is working.
 */
export type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number | null; readonly message: string | null }

/**
 * Run a read, and turn a failure into something renderable.
 *
 * `message` is the API's own sentence where there is one, and `null` where the request never
 * reached the API at all — in which case the caller supplies its own wording rather than
 * inventing detail about a failure nobody observed.
 */
export async function attempt<T>(work: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, status: error.status, message: error.message }
    }

    /*
     * Server-side only, and deliberately without the request's details. This domain's
     * requests carry filters naming template keys and date ranges, and its RESPONSES carry
     * who the clinic contacted. None of that belongs in a log because a socket closed.
     */
    console.error('[notifications] a request to the API did not complete', error)

    return { ok: false, status: null, message: null }
  }
}
