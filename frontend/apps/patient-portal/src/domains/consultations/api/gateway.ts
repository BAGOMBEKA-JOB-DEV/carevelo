import { cookies } from 'next/headers'
import { ApiClient } from '@carevelo/api-client'
import { requestHost } from '@/lib/tenant'

/**
 * The one way this domain talks to the API, server-side, as the signed-in patient.
 *
 * WHY THIS EXISTS AT ALL, given @carevelo/api-client. The client owns the request; it
 * deliberately owns nothing about WHERE the request goes or WHO it is from, because a
 * `tenantId` parameter on a shared HTTP client is the shape of a cross-tenant read
 * attempt. So each caller has to assemble three things the API needs before it will
 * treat a server-rendered request as this patient's:
 *
 *   Host          tenancy is resolved from it, and only from it
 *   Cookie        the Sanctum session, forwarded from the browser's request
 *   Origin        without it Sanctum does not consider the request to be from its own
 *                 frontend, the session is ignored, and `auth:sanctum` answers 401 —
 *                 which looks exactly like being signed out
 *
 * That assembly is copied in `src/lib/tenant.ts` and `src/lib/session.ts` already, and
 * this is the third copy. It is here rather than in `src/lib/` because a domain may not
 * write into app-global code and this one is not mine to change; the right end state is
 * one `src/lib/api.ts` factory that all three call, and it is named in the handover
 * notes rather than smuggled in.
 *
 * @see docs/40-api/authentication-and-sessions.md
 * @see docs/30-architecture/multi-tenancy.md — the tenant is never a client-supplied value
 */

/**
 * The API origin for the clinic this request was made to.
 *
 * The CLINIC's subdomain is preserved and only the origin swapped. Losing the subdomain
 * resolves the wrong clinic, or none — see `originFor()` in src/lib/tenant.ts, which this
 * mirrors exactly.
 */
async function apiOrigin(host: string): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    return `https://${host}`
  }

  const url = new URL(configured)
  url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`

  return url.origin
}

/**
 * The host this request was really made to.
 *
 * `x-forwarded-host` first, because `host` loses the clinic's subdomain on the render Next
 * performs after a Server Action calls redirect() — which is precisely the render every
 * one of this domain's screens is reached by. See requestHost() in src/lib/tenant.ts.
 */
async function currentHost(): Promise<string> {
  return (await requestHost()) ?? 'localhost'
}

async function sessionCookies(): Promise<string> {
  const jar = await cookies()

  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

/**
 * A client for reads, carrying this patient's session.
 *
 * Reads only. An unsafe verb needs the CSRF token as well, which is what `writingApi()`
 * below is for — separating them means a POST cannot be written by accident against a
 * client that will have it rejected with a 419 nobody can explain.
 */
export async function readingApi(): Promise<ApiClient> {
  const host = await currentHost()

  return new ApiClient({
    baseUrl: await apiOrigin(host),
    headers: {
      host,
      // See the header comment: without an Origin the session is ignored entirely.
      // `http://` rather than the real scheme, matching src/lib/session.ts — Sanctum
      // strips the scheme before matching the host against its stateful domains, so the
      // literal is not a bug waiting for production.
      Origin: `http://${host}`,
      Cookie: await sessionCookies(),
    },
  })
}

/**
 * A client for POSTs, carrying the session AND the CSRF token.
 *
 * `statefulApi()` is on in the backend, so an unsafe request authenticated by a session
 * cookie must also carry `X-XSRF-TOKEN` or Laravel answers 419. The token normally
 * already sits in the browser's jar from signing in; when it does not — a jar cleared, a
 * session resumed on a new device — it is fetched.
 */
export async function writingApi(): Promise<ApiClient> {
  const host = await currentHost()
  const origin = await apiOrigin(host)
  const token = await csrfToken(origin, host)

  const headers: Record<string, string> = {
    host,
    Origin: `http://${host}`,
    Cookie: await sessionCookies(),
  }

  if (token) {
    headers['X-XSRF-TOKEN'] = token
  }

  return new ApiClient({ baseUrl: origin, headers })
}

/**
 * The CSRF token for this session.
 *
 * THE ONE RAW FETCH IN THIS DOMAIN, and it is unavoidable rather than convenient:
 * `/sanctum/csrf-cookie` is not under `/api`, and ApiClient prefixes `/api` to every path
 * it is given. That is the same reason @carevelo/realtime cannot reach `/broadcasting/auth`
 * through the client and must not be taught to. Nothing else here bypasses it.
 *
 * Failure is silent and returns undefined. A missing token produces a 419 on the write,
 * which the caller already renders as a sentence; throwing here would turn a recoverable
 * write into a broken page.
 */
async function csrfToken(origin: string, host: string): Promise<string | undefined> {
  const jar = await cookies()
  const existing = jar.get('XSRF-TOKEN')?.value

  if (existing) {
    return existing
  }

  try {
    const response = await fetch(`${origin}/sanctum/csrf-cookie`, {
      headers: { Accept: 'application/json', Origin: `http://${host}`, Cookie: await sessionCookies() },
      cache: 'no-store',
    })

    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';')
      const separator = pair?.indexOf('=') ?? -1

      if (!pair || separator < 0) {
        continue
      }

      if (pair.slice(0, separator).trim() === 'XSRF-TOKEN') {
        return decodeURIComponent(pair.slice(separator + 1).trim())
      }
    }
  } catch {
    return undefined
  }

  return undefined
}
