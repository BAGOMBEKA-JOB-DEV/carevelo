import { cookies } from 'next/headers'
import type { components } from '@carevelo/api-client'
import { requestHost } from '@/lib/tenant'

/**
 * Who is signed in.
 *
 * TAKEN FROM THE CONTRACT NOW. This used to be a hand-written interface — the one in the
 * workspace — because GET /v1/me was a route closure returning the Eloquent model raw, so
 * there was no schema to generate from. That endpoint is a controller method returning
 * MeResource, so the type comes from the generated client like every other, and the raw
 * model's tenant_id and timestamps no longer reach a patient's browser.
 *
 * The alias is kept because every page imports `Me`; it is now an alias for the generated
 * shape rather than a second, independent description of it that was free to drift.
 */
export type Me = components['schemas']['MeResource']

/**
 * Who is signed in, according to the API.
 *
 * Asks the API rather than reading the cookie, because the cookie is opaque and the API
 * is the only thing that can say whether the session is still valid — a role change, a
 * deactivation or a suspension all invalidate it server-side.
 *
 * Returns null for a guest rather than redirecting, so a page can decide: the portal's
 * home page shows a sign-in prompt, and a records page redirects.
 */
export async function currentUser(): Promise<Me | null> {
  // See requestHost(): `host` loses the clinic's subdomain on an action-redirect render.
  const host = (await requestHost()) ?? 'localhost'
  const jar = await cookies()

  const configured = process.env.NEXT_PUBLIC_API_ORIGIN
  let origin = `https://${host}`

  if (configured) {
    const url = new URL(configured)
    url.host = `${host.split(':')[0]?.split('.')[0]}.${url.host}`
    origin = url.origin
  }

  const response = await fetch(`${origin}/api/v1/me`, {
    headers: {
      Accept: 'application/json',
      Origin: `http://${host}`,
      Cookie: jar.getAll().map((c) => `${c.name}=${c.value}`).join('; '),
    },
    // Never cached: this is per-session, and a cached identity on a shared handset is
    // one patient seeing another's name.
    cache: 'no-store',
  })

  if (!response.ok) {
    return null
  }

  // UNWRAPPED. An Eloquent API resource nests its payload under `data`, and the previous
  // version of this function read the body as the user itself — which is what a raw model
  // used to be. Reading it flat once the endpoint returned a resource left every field
  // undefined, so a signed-in patient rendered as a blank name rather than failing loudly.
  const body = (await response.json()) as { data?: Me }

  return body.data ?? null
}
