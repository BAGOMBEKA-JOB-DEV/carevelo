import type { DeliveryPaths } from './types'

/**
 * Building the URLs this domain navigates between.
 *
 * WHY NOT TEMPLATE STRINGS AT THE CALL SITE. The values that travel in these query
 * strings include the API's own sentence about why something failed, and a `&` or a quote
 * inside one silently truncates the next parameter or escapes somewhere it should not.
 * `URLSearchParams` encodes, once, here.
 *
 * EVERY BASE COMES FROM `DeliveryPaths`, WHICH THE ROUTE LAYER OWNS. Nothing in this
 * module knows a literal path, so the domain can be mounted anywhere — and, more to the
 * point, a Server Action can never be talked into redirecting somewhere a form told it
 * to. The one thing an action must never do is take its destination from the request.
 */
export function href(base: string, params: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value)
    }
  }

  const query = search.toString()

  return query === '' ? base : `${base}?${query}`
}

/**
 * One delivery's screen.
 *
 * The id is substituted rather than concatenated, so the route layer decides the whole
 * shape of the path — `/assignments/{delivery}` today, something else if these screens
 * are ever mounted twice. `encodeURIComponent` on a ULID is belt-and-braces and stays
 * anyway: the value came off the wire, and the one time it is not a ULID is the time it
 * matters.
 */
export function deliveryHref(
  paths: DeliveryPaths,
  id: string,
  params: Record<string, string | undefined> = {},
): string {
  return href(paths.delivery.replace('{delivery}', encodeURIComponent(id)), params)
}
