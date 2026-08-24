/**
 * Carrying the API's per-field sentences back to a form that posted natively.
 *
 * ============================================================
 * WHY THIS IS NECESSARY AT ALL
 * ============================================================
 *
 * A Server Action cannot hand a value back to a form that submitted without JavaScript —
 * the browser navigates, the action redirects, and everything the action learned is gone
 * unless it is in the URL. This surface ships no client JavaScript, so `useActionState` and
 * its friends are not available and are not wanted.
 *
 * The provisioning form has ten fields and the API answers a 422 with a sentence for each
 * one that is wrong. `humanise()` picks the first of them for the overall message, which is
 * enough for a two-field sign-in and not enough here: an operator told "the subdomain is
 * already taken" while the district is ALSO wrong will fix one thing, submit, and be told
 * the next. So the whole bag travels, as JSON, in one parameter.
 *
 * ============================================================
 * WHAT DOES NOT TRAVEL, AND WHY THAT IS DELIBERATE
 * ============================================================
 *
 * THE VALUES THE OPERATOR TYPED DO NOT COME BACK. A rejected provisioning form is empty
 * when it re-renders, and that is a real cost paid on purpose: putting a clinic's legal
 * name, contact telephone number and contact email address into a query string writes them
 * into every access log, proxy log and browser history entry between this server and the
 * operator's screen. Those are a named person's working contact details at a small clinic.
 * They are not clinical, and they are still not worth scattering to make a form feel nicer.
 *
 * The screen says so where the operator can read it, rather than leaving them to conclude
 * the form is broken.
 *
 * ============================================================
 * THE PARSE IS DEFENSIVE BECAUSE THE INPUT IS A URL
 * ============================================================
 *
 * Anyone can type anything into the query string. Nothing here throws, nothing here trusts
 * a shape, and the result is always a plain record of strings — a hand-edited parameter
 * produces an empty bag rather than an error boundary on a control plane.
 */

/** Longer than any realistic validation bag, and short enough not to be a URL somebody
    can use to make this app do work. Anything above it is dropped whole. */
const MAX_LENGTH = 2000

export function encodeFieldErrors(fields: Record<string, string>): string | undefined {
  const entries = Object.entries(fields)

  if (entries.length === 0) {
    return undefined
  }

  const encoded = JSON.stringify(fields)

  return encoded.length > MAX_LENGTH ? undefined : encoded
}

export function decodeFieldErrors(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw === '' || raw.length > MAX_LENGTH) {
    return {}
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {}
  }

  const result: Record<string, string> = {}

  for (const [field, message] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof message === 'string') {
      result[field] = message
    }
  }

  return result
}
