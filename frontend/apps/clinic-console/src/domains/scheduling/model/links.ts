/**
 * Building the URLs this domain navigates between.
 *
 * WHY NOT TEMPLATE STRINGS AT THE CALL SITE. Several of these values are free text — a
 * clinician's name, a reason a booking failed, a date — and concatenating them into a query
 * string by hand is how an `&` inside a value silently truncates the next parameter.
 * `URLSearchParams` encodes, once, here.
 *
 * EVERY BASE COMES FROM `SchedulePaths`, WHICH THE ROUTE LAYER OWNS. Nothing in this module
 * knows a literal path, which is what stops a server action being talked into redirecting
 * somewhere a form told it to. The one thing an action must never do is take its
 * destination from the request.
 */
export function href(
  base: string,
  params: Record<string, string | number | undefined>,
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
