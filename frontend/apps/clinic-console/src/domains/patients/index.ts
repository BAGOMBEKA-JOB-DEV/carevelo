/**
 * The patients domain's PUBLIC SURFACE: the registry, registration at the desk, the record,
 * consent, merge, and issuing a portal account.
 *
 * Everything this domain offers the rest of the app is exported here and nothing else is
 * importable — reaching into ./components, ./api or ./model from a route or another domain is a
 * build failure rather than a code-review note. Cross-domain composition belongs in the route
 * layer, and that layer is deliberately thin: every export below is a whole screen or the one
 * read a route needs in order to decide whether the screen can be rendered at all.
 *
 * ============================================================================
 * WHAT IS NOT HERE, AND WHY THE OMISSIONS ARE THE INTERESTING PART.
 * ============================================================================
 *
 * `registerPatient`, `updatePatient`, `mergePatient`, `recordConsent`, `withdrawConsent` and
 * `issueAccount` are NOT exported. Every one of them is called from a Server Action defined
 * inside the component that renders the form it belongs to, with the consequential values —
 * the policy version, `granted_by`, the survivor's identifier, the account's email address —
 * BOUND IN AT RENDER TIME rather than posted. Exporting them would let a route, or a later
 * screen in a hurry, record a consent decision from somewhere that never rendered the policy,
 * or issue an account against an address no record holds. The compliance controls live in the
 * shape of this surface, not only in the components behind it.
 *
 * `listPatients` and `consentHistory` are not exported either, and that one is worth a
 * sentence. They are reads, and reads are usually safe to share — but each screen here is
 * responsible for degrading when its own read fails, and handing a route a list function
 * invites the route to fetch, catch and re-render, which is the business logic this domain owns
 * moving into the routing tree where nothing looks for it.
 *
 * The transport in api/http.ts is not exported. It is plumbing with one way in.
 *
 * ============================================================================
 * WHAT A ROUTE HAS TO DO, IN FULL.
 * ============================================================================
 *
 * Seven screens. Each is rendered inside `<ConsoleShell title=… active="patients">` by the
 * route, exactly as the placeholder pages already do — the shell is applied by pages because
 * only a page knows which nav section it is.
 *
 *   <RegistryScreen        paths status find cursor done />
 *   <RegisterScreen        paths error field />
 *   <PatientRecordScreen   paths patient done error />
 *   <PatientDetailsScreen  paths patient error field />
 *   <ConsentDeskScreen     paths patient language error done />
 *   <MergeScreen           paths survivor duplicate cursor error />
 *   <IssueAccountScreen    paths patient />
 *
 * `paths` is `PatientsPaths` — where the route layer has mounted these screens. This domain
 * hard-codes no URL, so a Server Action can never be talked into redirecting somewhere a form
 * told it to.
 *
 * Everything after `paths` and `patient` is read straight out of `searchParams` and passed
 * through unaltered. The screens own the meaning; the route only carries the values. A route
 * that started interpreting `?done=merged` would be this domain's rules restated in the routing
 * tree, free to drift from the screens that enforce them.
 *
 * THE FIVE SCREENS THAT TAKE A `patient` NEED THE ROUTE TO READ IT, and that is the one piece
 * of work a route in this domain genuinely does. `tryReadPatient` answers `null` for a record
 * that does not exist AND for one belonging to another clinic — 404 and 403 collapse to the
 * same answer on purpose, because the API refuses to distinguish them and a frontend that did
 * would hand that distinction straight back. The route calls `notFound()` for either.
 *
 * NOTE THAT READING A RECORD IS AUDITED. `PatientController::show` writes a `patient.viewed`
 * event on every call, because the consent policy promises the patient in writing that every
 * staff access is recorded. A route must read the patient once, for a page it is actually going
 * to render — never speculatively, and never to decide whether to show a link.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 * @see docs/50-security-compliance/rbac-matrix.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

/* ---- Screens ----
   Server Components, every one, except the small account form nested inside
   IssueAccountScreen — which is 'use client' for a security reason rather than a convenience,
   and says so at length in its own file. Each posts natively and each degrades to a notice
   rather than throwing, so a failed secondary read leaves the patient's name and the way back
   on screen instead of the framework's error page. */
export { RegistryScreen, type RegistryScreenProps } from './components/RegistryScreen'
export { RegisterScreen, type RegisterScreenProps } from './components/RegisterScreen'
export {
  PatientRecordScreen,
  type PatientRecordScreenProps,
} from './components/PatientRecordScreen'
export {
  PatientDetailsScreen,
  type PatientDetailsScreenProps,
} from './components/PatientDetailsScreen'
export { ConsentDeskScreen, type ConsentDeskScreenProps } from './components/ConsentDeskScreen'
export { MergeScreen, type MergeScreenProps } from './components/MergeScreen'
export {
  IssueAccountScreen,
  type IssueAccountScreenProps,
} from './components/IssueAccountScreen'

/* ---- The one read a route performs ----
   Answers null for 404 and 403 alike; the route renders its own not-found for either. */
export { tryReadPatient } from './api/patients'

/* ---- The one type a route has to name ----
   `Patient` and `PatientStatus` are deliberately NOT re-exported. A route obtains a patient by
   calling `tryReadPatient` and hands it straight to a screen, so the type is inferred end to
   end and never written down; publishing it would invite a route to declare a variable of it,
   and a route holding a domain's central type is a route about to do something with it. */
export type { PatientsPaths } from './model/paths'
