import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ApiClient, ApiError } from '@carevelo/api-client'
import type { components } from '@carevelo/api-client'

export type Tenant = components['schemas']['TenantResource']

/**
 * Resolve the clinic from the request's Host header, server-side, before render.
 *
 * THE TENANT IS NEVER A CLIENT-SUPPLIED VALUE. It comes from the host and nowhere
 * else — not a query parameter, not a cookie, not a body field. The API ignores any
 * client attempt to assert it, and this function is the frontend half of that: there
 * is no argument to pass a tenant in.
 *
 * Resolved BEFORE render rather than fetched in the page, because the branding has to
 * be in the first HTML byte. A moment of Carevelo colours where the clinic's should
 * be tells the patient, correctly, that they are dealing with a stranger — and that
 * is the entire proposition of a white-label product.
 *
 * AN UNKNOWN SUBDOMAIN IS A PLAIN 404. Not "no such clinic", not a redirect to a
 * Carevelo page: the fact that a given clinic uses Carevelo is that clinic's
 * commercial information, and enumeration of the customer list should not be a `for`
 * loop over subdomains. notFound() renders the same page for a host that never
 * existed and one that was offboarded last week.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 * @see docs/30-architecture/multi-tenancy.md
 */
export async function resolveTenant(): Promise<Tenant> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')

  if (!host) {
    notFound()
  }

  const client = new ApiClient({
    baseUrl: originFor(host),
    // Forwarded so the API resolves the same tenant this request was made to. The
    // cookie travels too, for a signed-in patient.
    headers: {
      host,
      ...cookieHeader(requestHeaders.get('cookie')),
    },
  })

  try {
    const response = await client.get<{ data: Tenant }>('/v1/tenant')

    return response.data
  } catch (error) {
    // 404 for an unknown host is the API telling us this clinic does not exist here.
    // Anything else is our problem, not the patient's, and must not be disguised as
    // a missing clinic — a 500 rendered as "not found" would hide an outage.
    if (error instanceof ApiError && error.status === 404) {
      notFound()
    }

    throw error
  }
}

/**
 * The API origin for this host.
 *
 * In production the portal and the API share the host, so the clinic's subdomain is
 * already correct and nothing needs rewriting. Locally they differ by port.
 */
function originFor(host: string): string {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN

  if (configured) {
    // The clinic's own subdomain, on the configured API origin: tenancy still comes
    // from the host, so it has to be preserved rather than replaced.
    const url = new URL(configured)
    url.host = `${host.split('.')[0]}.${url.host}`

    return url.origin
  }

  return `https://${host}`
}

function cookieHeader(cookie: string | null): Record<string, string> {
  return cookie ? { cookie } : {}
}
