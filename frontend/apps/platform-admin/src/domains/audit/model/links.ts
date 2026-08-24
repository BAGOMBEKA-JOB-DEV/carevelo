/**
 * Building the URLs this screen navigates between.
 *
 * WHY NOT TEMPLATE STRINGS AT THE CALL SITE. One of these values is a cursor, which is an
 * opaque base64 string that routinely contains characters a query string cares about, and
 * another is an `action` an operator typed. Concatenating either by hand is how a cursor
 * arrives at the API one character short and pages nowhere. `URLSearchParams` encodes,
 * once, here.
 *
 * THE PARAMETER NAMES ARE THE API'S OWN — `tenant_id`, `actor_id`, `from`, `to`, `cursor`.
 * The filter form is a plain GET form, so what it posts IS the URL, and a second vocabulary
 * between the form and the endpoint would be one more place for the two to disagree about
 * which clinic's trail is being read.
 *
 * The base always comes from `AuditPaths`, which the route layer owns.
 */
export function href(
  base: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value))
    }
  }

  const query = search.toString()

  return query === '' ? base : `${base}?${query}`
}
