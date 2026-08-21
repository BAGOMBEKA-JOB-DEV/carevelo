/**
 * The one URL this domain owns.
 *
 * ONE LINK FOR EVERYTHING, and that is a product requirement rather than a shortcut. The
 * confirmation SMS carries `{join_link}` (TemplateRegistry: "Join here: {join_link}"), the
 * lobby is at that link, the room is at that link, and the resume link after a dropped
 * call is that link again. "No app install. The join path is a link" only holds if there is
 * exactly one, memorable enough to be read down a telephone by a member of the front desk.
 *
 * IT CARRIES NO SECRET. The appointment identifier is a ULID and authorisation is the
 * session's — a stranger holding this URL gets a 404, and a patient of another clinic gets
 * a 404 rather than a 403, because the API never confirms that a record exists elsewhere.
 * The join TOKEN never appears here; it is issued and spent by POST, in the body.
 *
 * The route that renders it must therefore be `src/app/consultations/[appointment]/page.tsx`.
 * That coupling is why this is a function in the domain rather than a string typed out at
 * three call sites.
 */
export function consultationHref(appointmentId: string): string {
  return `/consultations/${encodeURIComponent(appointmentId)}`
}
