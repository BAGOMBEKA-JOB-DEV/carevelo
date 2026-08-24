import type { PatientsPaths } from '@/domains/patients'

/**
 * Where the patients domain is mounted, stated once.
 *
 * THE DOMAIN HARD-CODES NO URL and this is the only file that knows the shape of these routes.
 * Two things fall out of that, and the second is the one that matters:
 *
 *   1. Moving the section is an edit here, not a search across a dozen components.
 *   2. Every Server Action in the domain redirects to a path CLOSED OVER AT RENDER TIME from
 *      this object. None of them takes a destination from a form field, so there is no
 *      submission that can send a member of staff somewhere the app did not choose. On a
 *      surface behind authentication that is the difference between a redirect and an open
 *      redirect.
 *
 * NOT UNDER `src/domains/`, deliberately. `.dependency-cruiser.cjs` makes an import from a
 * domain into `src/app/` a build failure — "that inverts the layering and hides business logic
 * in the routing tree, where nothing looks for it" — so the values live here and travel INTO
 * the domain as a prop. The patient portal's `src/app/paths.ts` is the same arrangement for the
 * same reason.
 *
 * `typedRoutes` is not enabled on this app, so nothing checks that these resolve. The check is
 * `ls src/app/patients` against the strings below, and it is worth running whenever this grows.
 */
export const PATIENTS_PATHS: PatientsPaths = {
  registry: '/patients',
  register: '/patients/new',
  record: (patientId) => `/patients/${encodeURIComponent(patientId)}`,
  details: (patientId) => `/patients/${encodeURIComponent(patientId)}/details`,
  consent: (patientId) => `/patients/${encodeURIComponent(patientId)}/consent`,
  merge: (patientId) => `/patients/${encodeURIComponent(patientId)}/merge`,
  account: (patientId) => `/patients/${encodeURIComponent(patientId)}/account`,
}
