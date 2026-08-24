/**
 * The tenant domain's PUBLIC SURFACE.
 *
 * Everything this domain offers the rest of the app is exported here, and nothing else is
 * importable: reaching into ./components or ./api from another domain is a build failure
 * rather than a code-review note. Cross-domain composition belongs in the route layer.
 *
 * ==========================================================================
 * WHAT THIS DOMAIN IS
 *
 * H1 clinic onboarding and everything a clinic administrator changes afterwards: branding,
 * compliance references, services and prices, opening hours, colleagues and their clinical
 * registration, and the clinic's own payment connection. §K's target is first contact to
 * first consultation in under a day WITHOUT Carevelo staff involvement, so every screen
 * here is self-service and none of them blocks care.
 *
 * ADMINISTRATOR ONLY. Every endpoint behind these screens checks `clinic_admin` explicitly
 * and answers 403 to anyone else. The screens do not re-implement that check — they render
 * what the API's refusal means, which is why `Attempt` carries a status and why 401 and 403
 * produce different screens.
 *
 * ==========================================================================
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Seven screens. Each is a server component that fetches its own data and degrades to a
 * notice rather than throwing, so a route mounts one inside `<ConsoleShell>` and passes:
 *
 *   <SettingsHub               paths />
 *   <BrandingScreen            paths saved problem advice />
 *   <ComplianceScreen          paths saved problem />
 *   <ServicesScreen            paths saved problem />
 *   <WorkingHoursScreen        paths saved problem />
 *   <StaffScreen               paths cursor saved problem />
 *   <StaffMemberScreen         paths userId saved problem />
 *   <PaymentConnectionScreen   paths provider saved problem aggregatorMessage />
 *
 * `paths` is `TENANT_PATHS` — where the route layer has mounted these screens. This domain
 * hard-codes no URL, so it can be mounted anywhere and, more importantly, a Server Action
 * can never be talked into redirecting somewhere a form told it to: every path travels as
 * an encrypted bound argument and is re-checked as a same-origin path in the action.
 *
 * Everything after `paths` is read straight out of `searchParams` and passed through. The
 * screens own the meaning; the route only carries the values. `saved`, `problem`, `advice`
 * and `aggregator` are how a Server Action reports back — a redirect cannot return a value,
 * and the alternative would make every form a client component. See `components/screen.ts`.
 *
 * `provider` on the payment screen is the one that is not a report. It selects which
 * aggregator's vocabulary the credential panel wears — Flutterwave issues a secret key,
 * Pesapal a consumer key and a consumer secret — and it lives on the URL for the same
 * reason the others do: changing it must not require a bundle to have arrived.
 *
 * `userId` on `StaffMemberScreen` is the route's `[user]` segment, handed over raw. The
 * screen resolves it — there is no `GET /v1/tenant/users/{user}`, so it walks the clinic's
 * own staff list — and raises the 404 itself, because the same call can end three ways and
 * only one of them is "not found". See the note on that component.
 *
 * ==========================================================================
 * THE CONTRACT GAP EVERY SCREEN HERE WORKS AROUND
 *
 * No endpoint READS `TenantAdminResource`. `GET /v1/tenant` is public and returns branding
 * and contact only; the legal name, the subdomain, the tenant status, the trial end, the two
 * compliance references and `branding.contrast_advisories` exist only on the body that
 * `PATCH /v1/tenant` and `POST /v1/tenant/logo` return. `api/clinic.ts` documents the
 * consequences in full and names the one route that would close it.
 */

/* ---- Screens ---- */
export { SettingsHub, type SettingsHubProps } from './components/SettingsHub'
export { BrandingScreen, type BrandingScreenProps } from './components/BrandingScreen'
export { ComplianceScreen, type ComplianceScreenProps } from './components/ComplianceScreen'
export { ServicesScreen, type ServicesScreenProps } from './components/ServicesScreen'
export {
  WorkingHoursScreen,
  type WorkingHoursScreenProps,
} from './components/WorkingHoursScreen'
export { StaffScreen, type StaffScreenProps } from './components/StaffScreen'
export {
  StaffMemberScreen,
  type StaffMemberScreenProps,
} from './components/StaffMemberScreen'
export {
  PaymentConnectionScreen,
  type PaymentConnectionScreenProps,
} from './components/PaymentConnectionScreen'

/* ---- The persistent checklist ----
   Exported separately so a route outside /settings — the console's landing page, say — can
   put the strip at the top of its own screen. §H1.8 asks for a checklist that is always
   there rather than a wizard that runs once. */
export { OnboardingChecklist, type OnboardingChecklistProps } from './components/OnboardingChecklist'

/* ---- Reads, for a route that must 404, set a title, or link ----
   Both throw `ApiError` on failure; the screens above catch for themselves. A caller
   outside this domain is expected to decide what a failure means on its own surface, which
   is why these are not wrapped. */
export { getClinic } from './api/clinic'

/* ---- The one boolean the rest of the console needs from this domain ----
   `accepts_online_payment` decides whether a clinic can be offered an online collection at
   all. It lives on an administrator-only endpoint, so the scheduling and payments surfaces
   cannot read it for themselves — and the safe default everywhere is `false`, because a
   patient sent to pay at the desk is a smaller failure than a slot held for fifteen minutes
   against a payment nobody can make. */
export { getAggregatorAccount } from './api/aggregator'

/* ---- Types, all of them from the generated contract ---- */
export type {
  AggregatorAccount,
  ChecklistItem,
  Clinic,
  ClinicianProfile,
  OnboardingChecklist as OnboardingChecklistData,
  RegistrationBody,
  Service,
  Staff,
  StaffRole,
  TenantPaths,
  WorkingHour,
} from './model/types'

/*
 * DELIBERATELY NOT EXPORTED: every write.
 *
 * `saveClinic`, `uploadLogo`, `createService`, `replaceWorkingHours`, `inviteStaff`,
 * `updateStaff`, `createClinicianProfile`, `saveAggregatorCredentials` and
 * `verifyAggregatorAccount` are reachable only through the Server Actions in this domain's
 * own screens. That is not tidiness. Three of them carry rules that live in the ACTION
 * rather than in the API call — an empty compliance box means "leave it alone" and not
 * "erase it", a working-hours submission must carry all seven days or delete the missing
 * ones, and a clinician profile must send `registration_number` even when it is empty. An
 * exported write function is an invitation to call it without those, from a route that has
 * no idea they exist.
 *
 * `getChecklist` is likewise internal: it needs runtime narrowing the generated types do not
 * provide, and `OnboardingChecklist` is the component that already does it.
 */
