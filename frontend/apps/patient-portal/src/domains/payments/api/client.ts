import { cookies, headers } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { ApiClient } from '@carevelo/api-client'
import { requestHost } from '@/lib/tenant'

/**
 * An ApiClient that carries this request's session, this request's clinic and this
 * request's language.
 *
 * EVERY CALL GOES THROUGH @carevelo/api-client, which is a boundary rule rather than a
 * preference: the client owns `credentials: 'include'`, the Idempotency-Key header and the
 * RFC 9457 translation, and a raw fetch beside it would be a second, drifting copy of all
 * three. What this module adds is the three things a SERVER-side call needs that a browser
 * would have supplied on its own.
 *
 * 1. THE COOKIE. The portal renders on a server; the patient's session cookie is in their
 *    browser. It has to be copied onto the outgoing request or the API sees a guest.
 * 2. THE HOST. Tenancy is resolved from the Host header and from nothing else. An origin
 *    that lost the clinic's subdomain resolves the wrong clinic, or none — and the API
 *    ignores any client attempt to assert a tenant by other means, which is why there is no
 *    tenant parameter anywhere in this file.
 * 3. THE LANGUAGE. `Accept-Language` selects `en` or `lg` server-side, so a patient reading
 *    in Luganda gets the API's own sentences in Luganda rather than an English validation
 *    message inside an otherwise-Luganda screen.
 *
 * KNOWN DUPLICATION, STATED RATHER THAN HIDDEN. `src/lib/tenant.ts` and
 * `src/lib/session.ts` each build the same origin the same way, and neither exports it.
 * This is the third copy. It belongs in `src/lib/api.ts` — which `.dependency-cruiser.cjs`
 * already names as the one module allowed to hold it — and moving it there is a change to
 * shared code that this domain does not own.
 *
 * @see docs/30-architecture/multi-tenancy.md
 * @see docs/40-api/authentication-and-sessions.md
 */

/** The API origin for this request's clinic. */
async function apiOrigin(host: string): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (!configured) {
    // Production: the portal and the API share the host, so the subdomain is already right.
    return `https://${host}`
  }

  // Locally they differ by port. The CLINIC's subdomain is preserved and only the origin
  // swapped — the port is stripped before the subdomain is read, because `kira.localhost:3000`
  // split on '.' would otherwise carry the port into the new host.
  const url = new URL(configured)
  url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`

  return url.origin
}

/**
 * The portal's own origin, which Sanctum compares against its stateful-domain list before
 * it will treat the cookie as a session at all.
 *
 * The scheme is read from `x-forwarded-proto` rather than hard-coded. The two existing
 * copies of this plumbing hard-code `http://`, which is right locally and wrong the moment
 * anything runs behind TLS — and a mismatched Origin does not fail loudly, it silently
 * downgrades the request to a guest.
 */
async function portalOrigin(host: string): Promise<string> {
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
 * A client for READING. Safe from a Server Component.
 */
export async function readClient(): Promise<ApiClient> {
  const host = (await requestHost()) ?? 'localhost'

  return new ApiClient({
    baseUrl: await apiOrigin(host),
    headers: {
      host,
      Origin: await portalOrigin(host),
      Cookie: await cookieHeader(),
      'Accept-Language': await getLocale(),
    },
  })
}

/**
 * A client for WRITING, carrying the CSRF token the API requires on an unsafe verb.
 *
 * ONLY FROM A SERVER ACTION. It may have to mint the token, which means writing a cookie,
 * and Next allows that only in an Action or a Route Handler. Calling it during a render
 * throws — deliberately, since the alternative would be a payment POST that silently 419s
 * and reads to the patient as a payment that did not start.
 *
 * `statefulApi()` puts the whole `/api` group behind session cookies AND CSRF validation
 * (backend/bootstrap/app.php), so a POST without `X-XSRF-TOKEN` is refused. A signed-in
 * patient's browser already holds `XSRF-TOKEN`, because sign-in forwarded it; the mint is
 * for the case where it has expired underneath them.
 */
export async function writeClient(): Promise<ApiClient> {
  const host = (await requestHost()) ?? 'localhost'
  const origin = await apiOrigin(host)
  const from = await portalOrigin(host)
  const token = await csrfToken(origin, from)

  return new ApiClient({
    baseUrl: origin,
    headers: {
      host,
      Origin: from,
      Cookie: await cookieHeader(),
      'Accept-Language': await getLocale(),
      ...(token ? { 'X-XSRF-TOKEN': token } : {}),
    },
  })
}

async function csrfToken(origin: string, from: string): Promise<string | undefined> {
  const jar = await cookies()
  const held = jar.get('XSRF-TOKEN')?.value

  if (held) {
    return held
  }

  /*
   * A raw fetch, and the one in this domain. It is not an API DATA call — there is no
   * contract type to drift from, the response is 204 with no body — and the client cannot
   * serve it for two reasons: the endpoint is on the `web` middleware group rather than
   * under /api, and this needs the response's Set-Cookie headers, which ApiClient
   * deliberately does not expose.
   */
  const response = await fetch(`${origin}/sanctum/csrf-cookie`, {
    headers: { Accept: 'application/json', Origin: from, Cookie: await cookieHeader() },
    cache: 'no-store',
  })

  let minted: string | undefined

  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(';')[0] ?? ''
    const separator = pair.indexOf('=')

    if (separator < 0) {
      continue
    }

    const name = pair.slice(0, separator).trim()
    const value = decodeURIComponent(pair.slice(separator + 1).trim())

    // Re-issued on the portal's own response so the browser holds what the API just
    // issued; without this the next request mints another one and the session churns.
    jar.set({ name, value, path: '/', sameSite: 'lax', httpOnly: name !== 'XSRF-TOKEN' })

    if (name === 'XSRF-TOKEN') {
      minted = value
    }
  }

  return minted
}
