import type { components, paths } from '@carevelo/api-client'

/**
 * Every type this domain speaks, taken FROM THE GENERATED CONTRACT.
 *
 * Nothing here is hand-written except where the generator is demonstrably wrong, and each
 * of those places says so and says why. `docs/30-architecture/frontend-nextjs.md` forbids
 * a hand-written request or response type outright, for the reason a second copy of
 * anything drifts: the copy compiles long after the contract it copied has moved.
 *
 * @see packages/api-client/src/generated/schema.d.ts — generated from docs/40-api/openapi.yaml
 */

/* ============================================================================
   THE CLINIC
   ============================================================================ */

/**
 * The clinic as ANYONE may read it: trading name, resolved branding tokens, contact
 * details. This is what `GET /v1/tenant` returns.
 */
export type Clinic = components['schemas']['TenantResource']

/**
 * The clinic as its own administrator may read it: legal name, subdomain, status, trial,
 * compliance references, and `branding.contrast_advisories`.
 *
 * ONLY EVER SEEN AS THE ANSWER TO A WRITE. There is no GET that returns this resource —
 * `PATCH /v1/tenant` and `POST /v1/tenant/logo` return it and nothing else does. That is a
 * real gap in the contract rather than an oversight in this domain, and every screen that
 * wants one of these administrator-only fields has to work without it until a save has
 * happened. See `api/clinic.ts` and the report accompanying this domain.
 */
export type ClinicAdminView = components['schemas']['TenantAdminResource']

/** The branding block an administrator sees, advisories included. */
export type AdminBranding = ClinicAdminView['branding']

/** The branding block the PATIENT PORTAL is given. This is what a preview must mirror. */
export type PublicBranding = Clinic['branding']

/** Branding, contact details and compliance references, all optional, all `sometimes`. */
export type ClinicChanges =
  components['schemas']['App.Http.Requests.Admin.Tenant.UpdateTenantRequest']

/* ============================================================================
   THE ONBOARDING CHECKLIST
   ============================================================================ */

type ChecklistResponse =
  paths['/v1/tenant/onboarding-checklist']['get']['responses'][200]['content']['application/json']['data']

/** One item of the generated tuple, before the corrections below. */
type GeneratedChecklistItem = ChecklistResponse['items'][number]

/**
 * One line of the checklist.
 *
 * KNOWN CONTRACT IMPRECISION, recorded rather than papered over — the same class of thing
 * the consent policy endpoint carries a note about, and for the same underlying reason:
 * the generator infers the response from the runtime shape of one example payload, and PHP
 * loses information on the way out.
 *
 *   - `key` and `label` publish as the literal strings of the seeded example, so the
 *     generated type is a seven-member TUPLE of literal types rather than a list. Coding
 *     against that would make adding an eighth checklist item a compile error in this app,
 *     which is precisely backwards.
 *   - `is_complete` publishes as `string` on three of the seven, because those three are
 *     computed from expressions PHP's static analysis could not resolve to a bool. It is a
 *     boolean on every one of them; `TenantAdminController::checklistItems()` types the
 *     return `is_complete: bool` and the JSON carries `true`/`false`.
 *   - `detail` publishes as `null` on the four that had none in the example. It is
 *     `?string` in the controller's own docblock.
 *
 * So the four fields are widened here, deliberately and in one place, and `is_required` is
 * still taken from the generated type so the link to the contract is not cut entirely.
 * Runtime narrowing lives in `api/clinic.ts`, because a widened TYPE is a claim about the
 * shape and not a check of it.
 */
export type ChecklistItem = Omit<
  GeneratedChecklistItem,
  'key' | 'label' | 'is_complete' | 'detail'
> & {
  key: string
  label: string
  is_complete: boolean
  detail: string | null
}

/** What remains before the clinic is live. */
export type OnboardingChecklist = {
  tenant_status: ChecklistResponse['tenant_status']
  items: readonly ChecklistItem[]
  is_ready_to_activate: ChecklistResponse['is_ready_to_activate']
  note: ChecklistResponse['note']
}

/* ============================================================================
   SERVICES AND HOURS
   ============================================================================ */

export type Service = components['schemas']['ServiceResource']
export type NewService = components['schemas']['StoreServiceRequest']
export type ServiceChanges = components['schemas']['UpdateServiceRequest']

/** `in_person | video | voice | chat`. Voice and chat are first-class, not fallbacks. */
export type ConsultationMode = components['schemas']['ConsultationMode']

export type WorkingHour = components['schemas']['WorkingHourResource']
export type WeekChanges = components['schemas']['UpdateWorkingHoursRequest']

/* ============================================================================
   STAFF AND CLINICIANS
   ============================================================================ */

export type Staff = components['schemas']['StaffResource']
export type StaffChanges = components['schemas']['UpdateStaffRequest']
export type Invitation = components['schemas']['InviteStaffRequest']

/**
 * The roles a clinic administrator may hand out.
 *
 * From the invitation request rather than from a list of our own: `InviteStaffRequest`
 * is where the backend decides this, and it deliberately excludes `patient` and every
 * platform role — a clinic cannot mint a Carevelo operator by inviting one.
 */
export type StaffRole = Invitation['role']

/** One page of the staff list. Cursor-paginated; there is no offset anywhere in this API. */
export type StaffPage =
  paths['/v1/tenant/users']['get']['responses'][200]['content']['application/json']

export type ClinicianProfile = components['schemas']['ClinicianProfileResource']
export type NewClinicianProfile = components['schemas']['StoreClinicianRequest']
export type ClinicianProfileChanges = components['schemas']['UpdateClinicianRequest']

/** `umdpc | ahpc | nurses_midwives`. Recorded, never verified — see ComplianceScreen. */
export type RegistrationBody = components['schemas']['RegistrationBody']

/* ============================================================================
   THE CLINIC'S OWN MERCHANT ACCOUNT
   ============================================================================ */

/**
 * Provider, status, environment, last verification — and NO CREDENTIAL.
 *
 * `credentials_are_write_only` is `true` on every response and there is no field on this
 * type that could hold a secret. Nothing in this domain may build a control that reads one
 * back, because there is nothing to read back: the resource enumerates its fields
 * deliberately and the policy behind it returns false for every role.
 */
export type AggregatorAccount = components['schemas']['AggregatorAccountResource']

export type AggregatorCredentials = components['schemas']['UpdateAggregatorAccountRequest']

export type AggregatorProvider = AggregatorCredentials['provider']
export type AggregatorEnvironment = AggregatorCredentials['environment']

type VerifyResponse =
  paths['/v1/tenant/aggregator-account/verify']['post']['responses'][200]['content']['application/json']

/**
 * The outcome of a verification.
 *
 * `message` is the AGGREGATOR'S OWN WORDS on a failure and `null` on success. The
 * generated type says `verification_message: string` because the example payload carried
 * one; `AggregatorAccountController::verify()` initialises `$message = null` and only
 * assigns it in the `catch`. Widened here rather than asserted away at the call site.
 *
 * The message is shown VERBATIM. Only the aggregator knows why a key was refused, and
 * paraphrasing loses the part the administrator can act on.
 */
export type VerificationResult = {
  account: VerifyResponse['data']
  message: string | null
}

/* ============================================================================
   WHERE THE ROUTE LAYER MOUNTED THESE SCREENS
   ============================================================================ */

/**
 * The paths this domain's forms post back to and redirect between.
 *
 * NOTHING IN THIS DOMAIN HARD-CODES A URL. Two reasons, and the second is the one that
 * matters: the screens can be mounted anywhere, and a Server Action can never be talked
 * into redirecting somewhere a form field told it to. Every path below arrives as an
 * encrypted bound argument and is checked as a same-origin path again in the action,
 * because an open redirect on a screen that handles merchant credentials is a phishing kit
 * with the clinic's own name on it.
 */
export type TenantPaths = {
  /** The settings landing screen: the checklist and the way into everything else. */
  readonly hub: string
  readonly branding: string
  readonly compliance: string
  readonly services: string
  readonly hours: string
  readonly staff: string
  /** One colleague. Must contain the literal `{user}`. */
  readonly staffMember: string
  readonly payments: string
}
