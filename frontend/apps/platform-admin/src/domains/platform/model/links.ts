/**
 * Building the URLs this domain navigates between.
 *
 * WHY NOT TEMPLATE STRINGS AT THE CALL SITE. Two of these values are text coming back from
 * the API — the sentence explaining why a lifecycle change was refused — and one is a
 * cursor, which is an opaque base64 string that routinely contains characters a query
 * string cares about. Concatenating either by hand is how a `&` inside a message silently
 * truncates the next parameter, and how a cursor arrives at the API one character short and
 * pages nowhere. `URLSearchParams` encodes, once, here.
 *
 * EVERY BASE COMES FROM `PlatformPaths`, WHICH THE ROUTE LAYER OWNS. Nothing in this module
 * knows a literal path, so a Server Action can never be talked into redirecting somewhere a
 * form told it to.
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
