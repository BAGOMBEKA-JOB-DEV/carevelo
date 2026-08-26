import { cookies, headers } from 'next/headers'
import { ApiClient, ApiError } from '@carevelo/api-client'
import { requestHost } from '@/lib/tenant'

/**
 * The plumbing every call in this domain goes through: the clinic's host, the patient's
 * session, and — for the one write this domain performs — the CSRF token that makes the
 * session count.
 *
 * WHY A WRITE NEEDS MORE THAN A COOKIE. `bootstrap/app.php` calls `statefulApi()`, so the
 * API group runs `EnsureFrontendRequestsAreStateful`, which turns a request from a
 * configured frontend origin into a SESSION-authenticated one and — in the same breath —
 * subjects it to CSRF validation. Two consequences follow, and both were learned the hard
 * way on the sign-in path:
 *
 *   1. `Origin` must be sent. Statefulness is decided by matching that header against
 *      `sanctum.stateful`; without it the request is treated as a token request, Sanctum
 *      finds no bearer token, and a signed-in patient gets 401.
 *   2. `X-XSRF-TOKEN` must be sent on the POST, matching the `XSRF-TOKEN` cookie. Absent,
 *      the answer is 419 and the patient is told their session expired when it did not.
 *
 * NOTE FOR WHOEVER CONSOLIDATES THIS. `patientApi()` and `apiOrigin()` are duplicated in
 * the prescriptions domain, and `.dependency-cruiser.cjs` already names `src/lib/api.ts`
 * as the sanctioned home for a shared one. They are not there yet only because `src/lib/`
 * is app-global and several domains are being written in parallel; a single deliberate
 * move is better than two agents racing to create the same file. The CSRF handling below
 * is the part that should NOT be copied a third time — it is security-relevant plumbing
 * and deserves exactly one implementation.
 *
 * @see apps/patient-portal/src/domains/identity/api/session.ts — the same problem, solved
 *      first, with the full history of why the cookie has to be re-issued
 */

/**
 * The API origin for this host, with the CLINIC's subdomain preserved.
 *
 * Tenancy is resolved from the host, so an origin that lost the subdomain resolves the
 * wrong clinic or none — which surfaces as a 404 on a page the patient reached from their
 * own account, and looks nothing like a configuration mistake.
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
 * An authenticated client for THIS request.
 *
 * Built per call and never memoised: `headers()` is request-scoped, and a client held
 * across requests would carry one patient's cookie into another patient's render.
 */
export async function patientApi(): Promise<ApiClient> {
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
      // from "explicitly undefined", and a literal undefined would be sent as a header.
      ...(cookie === null ? {} : { cookie }),
    },
  })
}

/** The result of the one write this domain makes. Failure is a value, never a throw. */
export interface WriteResult {
  ok: boolean
  /**
   * The API's own sentence, already humanised from problem details — or `null` when the
   * request never reached the API. Null rather than a sentence invented here, because a
   * string built in this module cannot be translated; the caller renders its own
   * catalogue's wording instead.
   */
  message: string | null
  /** 409 from the state machine: a controlled item, or consent that is not (or no longer) granted. */
  refused: boolean
}

/**
 * POST to the API as the signed-in patient, with CSRF.
 *
 * ONLY CALLABLE FROM A SERVER ACTION OR ROUTE HANDLER, because it may write a cookie —
 * Next forbids that during an ordinary render, and rightly: a GET that mutates the jar is
 * a GET with a side effect.
 */
export async function postAsPatient(path: string, body: unknown): Promise<WriteResult> {
  try {
    const host = (await requestHost()) ?? 'localhost'
    const origin = apiOrigin(host)
    const token = await csrfToken(origin, host)
    const jar = await cookies()

    const api = new ApiClient({
      baseUrl: origin,
      headers: {
        host,
        // See (1) in the note at the top: without this the request is not stateful and
        // the session cookie is ignored.
        origin: `http://${host}`,
        cookie: jar
          .getAll()
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join('; '),
        ...(token === undefined ? {} : { 'X-XSRF-TOKEN': token }),
      },
    })

    /*
     * NO Idempotency-Key. The API requires one on unsafe, NON-IDEMPOTENT writes — a
     * payment attempt above all, where two taps on a slow connection must not become two
     * collections. Recording a fulfilment method is idempotent by construction: it sets a
     * column to one of two values, and posting `pickup` twice leaves the order in exactly
     * the state posting it once did. Sending a key here would imply a guarantee the
     * endpoint neither needs nor makes.
     */
    await api.post<unknown>(path, body)

    return { ok: true, message: null, refused: false }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message, refused: error.status === 409 }
    }

    return { ok: false, message: null, refused: false }
  }
}

/**
 * The CSRF token, bootstrapping the cookie if the browser does not have one yet.
 *
 * `/sanctum/csrf-cookie` is on the `web` middleware group and NOT under `/api`, so
 * ApiClient — which prefixes every path with `/api` — cannot reach it and must not be
 * taught to. This is the one raw fetch in the domain and it exists for that reason alone.
 *
 * The `Set-Cookie` it returns is re-issued on the portal's own response, because the
 * portal is a separate server from the API: a cookie set here and not forwarded is a
 * cookie the browser never sees, and the next request arrives without it.
 */
async function csrfToken(origin: string, host: string): Promise<string | undefined> {
  const jar = await cookies()
  const existing = jar.get('XSRF-TOKEN')?.value

  if (existing !== undefined) {
    return existing
  }

  const response = await fetch(`${origin}/sanctum/csrf-cookie`, {
    headers: {
      Accept: 'application/json',
      origin: `http://${host}`,
      cookie: jar
        .getAll()
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; '),
    },
    // Never cached, by anything. A shared CSRF token is not a CSRF token.
    cache: 'no-store',
  })

  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attributes] = raw.split(';')
    const separator = pair?.indexOf('=') ?? -1

    if (!pair || separator < 0) {
      continue
    }

    jar.set({
      name: pair.slice(0, separator).trim(),
      value: decodeURIComponent(pair.slice(separator + 1).trim()),
      httpOnly: attributes.some((attribute) => attribute.trim().toLowerCase() === 'httponly'),
      sameSite: 'lax',
      path: '/',
      // Domain left to the browser's default, so the cookie belongs to THIS host only —
      // which is what keeps one clinic's session off another clinic's subdomain.
    })
  }

  return (await cookies()).get('XSRF-TOKEN')?.value
}
