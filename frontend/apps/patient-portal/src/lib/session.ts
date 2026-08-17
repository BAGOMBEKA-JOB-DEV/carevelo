import { cookies, headers } from 'next/headers'

/**
 * Who is signed in.
 *
 * Declared here rather than taken from the generated client because GET /v1/me has NO
 * schema to take: the route is `fn (Request $request) => $request->user()`, returning the
 * Eloquent model raw. So the contract cannot describe it, and this is the one place in
 * the workspace with a hand-written response type.
 *
 * That is a defect in the endpoint, not a licence to hand-write types. Returning the raw
 * model also ships tenant_id, email_verified_at and both timestamps to a patient's
 * browser, which is more than the caller needs to know about itself. It should return a
 * resource; when it does, this type comes from the generated client like every other.
 */
export interface Me {
  id: string
  name: string
  phone?: string | null
}

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
  const host = (await headers()).get('host') ?? 'localhost'
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

  return (await response.json()) as Me
}
