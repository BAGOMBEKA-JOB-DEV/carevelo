/**
 * The patients domain's PUBLIC SURFACE: registration, consent, and a patient's own record.
 *
 * Everything this domain offers the rest of the app is exported here and nothing else is
 * importable — reaching into ./components or ./api from a route or another domain is a
 * build failure rather than a code-review note. Cross-domain composition belongs in the
 * route layer, and that layer is deliberately thin: every export below is a whole screen
 * or a whole server-side read, so a route file has nothing left to decide.
 *
 * WHAT IS NOT HERE, AND WHY THE OMISSIONS ARE THE INTERESTING PART.
 *
 *   `registerPatient`, `recordConsent`, `withdrawConsent` and `updatePatient` are NOT
 *   exported. Every one of them is called from a Server Action defined inside the
 *   component that renders the form it belongs to, with the decision bound in at render
 *   time. Exporting them would let a route — or a later screen in a hurry — post a consent
 *   decision from somewhere that never rendered the policy, which is precisely the failure
 *   the pinned `policy_version` exists to make impossible. The compliance controls live in
 *   the shape of this surface, not only in the components behind it.
 *
 *   The transport in api/http.ts is not exported either. It is plumbing with one way in.
 *
 *   `rememberRegistration`, `noteDecision` and `forgetRegistration` are not exported: they
 *   WRITE the handoff cookie, and Next refuses a cookie write during a page render, so a
 *   route could not call them if it tried. Only the read is public.
 *
 * READS ARE `try*` AND ANSWER `null` RATHER THAN THROWING, on purpose. A record belonging
 * to another clinic answers 404 rather than 403 so that nobody learns a named person is a
 * patient of a named clinic from the shape of a refusal. Both statuses collapse to `null`
 * here and the route calls `notFound()` for either, which is what keeps that distinction
 * from leaking back out through an error page.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

/* ---- Screens ----
   Each is an async Server Component and each posts natively. None of them fetches: a route
   reads with the functions below and passes the result in, so the loading and not-found
   states belong to the route where Next can actually render them. */
export { RegistrationForm, type RegistrationFormProps } from './components/RegistrationForm'
export { ConsentScreen, type ConsentScreenProps } from './components/ConsentScreen'
export { ConsentDeclined } from './components/ConsentDeclined'
export { ConsentHistory, type ConsentHistoryProps } from './components/ConsentHistory'
export { ProfileForm, type ProfileFormProps } from './components/ProfileForm'

/* ---- Server-side reads, for the route that renders the screen above it ---- */
export {
  currentConsentPolicy,
  tryConsentHistory,
  type ConsentHistoryPage,
} from './api/consents'
export { tryReadPatient } from './api/patients'

/**
 * The pointer to a registration this browser is part-way through.
 *
 * The consent route needs it because a self-registering patient has no account yet and so
 * cannot be identified from a session. `null` means the handoff expired or was never made,
 * and the route sends the patient back to registration rather than asking them to consent
 * on behalf of a record it cannot name. See api/handoff.ts for why this is a cookie and
 * emphatically not `?patient=<id>`.
 */
export { readRegistrationHandoff, type RegistrationHandoff } from './api/handoff'

/* ---- Types a route needs to hold the values it is passing through ---- */
export type {
  ConsentAction,
  ConsentGrantedBy,
  ConsentPolicy,
  ConsentRecord,
  ConsentType,
  Patient,
  PatientStatus,
} from './api/types'
