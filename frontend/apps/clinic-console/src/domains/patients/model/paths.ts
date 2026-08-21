/**
 * Where the route layer has mounted this domain's screens.
 *
 * THIS DOMAIN HARD-CODES NO URL, and that is worth more here than the usual "so it can be
 * mounted anywhere". Every screen in this domain either renders a form that posts to a Server
 * Action or renders a link a member of staff will follow with a patient in front of them, and
 * a Server Action that redirected somewhere a FORM told it to would be an open redirect on a
 * surface behind authentication. Passing the paths in from the route means the set of places
 * an action can send you is fixed at render time by the app, not at submit time by the
 * request.
 *
 * Functions rather than templates because a patient identifier is a ULID that goes in a path
 * segment and has to be encoded exactly once. `record('01J…')` cannot be got wrong; a
 * `'/patients/{id}'` string with a `.replace()` at each call site can be, and the failure —
 * a link to `/patients/%7Bid%7D` — looks like a 404 rather than a bug.
 *
 * Server-to-server props only. These are functions, so they cannot cross into a Client
 * Component; the one client component in this domain is given plain strings. That constraint
 * is deliberate rather than tolerated — see `IssueAccountForm`.
 */
export type PatientsPaths = {
  /** The registry: search, filter, page. */
  readonly registry: string
  /** Register a walk-in. */
  readonly register: string
  /** One patient's record — the hub every other screen returns to. */
  readonly record: (patientId: string) => string
  /** Correct contact and demographic details. */
  readonly details: (patientId: string) => string
  /** Consent capture and withdrawal, at the desk. */
  readonly consent: (patientId: string) => string
  /** Fold a duplicate registration into this record. */
  readonly merge: (patientId: string) => string
  /** Issue this patient a portal account. */
  readonly account: (patientId: string) => string
}
