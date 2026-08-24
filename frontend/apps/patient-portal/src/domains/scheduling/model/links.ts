/**
 * Building the URLs this domain navigates between.
 *
 * WHY NOT TEMPLATE STRINGS AT THE CALL SITE. Two of these values are patient-visible text
 * — a clinic's own sentence coming back from the API as the reason a booking failed, and
 * a booking reference — and one is a date. Concatenating them into a query string by hand
 * is how a `&` inside a message silently truncates the next parameter, and how a message
 * containing a quote ends up somewhere it should not. `URLSearchParams` encodes, once,
 * here.
 *
 * EVERY BASE COMES FROM `SchedulingPaths`, WHICH THE ROUTE LAYER OWNS. Nothing in this
 * module knows a literal path, so the domain can be mounted anywhere — and, more to the
 * point, a server action can never be talked into redirecting somewhere a form told it
 * to. The one thing an action must never do is take its destination from the request.
 */
export function href(base: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value))
    }
  }

  const query = search.toString()

  return query === '' ? base : `${base}?${query}`
}
