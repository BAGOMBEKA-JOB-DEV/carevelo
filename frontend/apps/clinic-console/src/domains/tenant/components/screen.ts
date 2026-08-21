import type { Attempt } from '../api/http'
import type { AggregatorAccount, Clinic, ConsultationMode, RegistrationBody, StaffRole } from '../model/types'

/**
 * The things every settings screen needs and none of them should say twice.
 *
 * Wording lives here rather than inline for one reason above the others: several of these
 * sentences are COMPLIANCE STATEMENTS, not copy. "Carevelo does not verify this" and
 * "money never passes through Carevelo" are claims the product is legally and
 * commercially bound to, and a claim restated in four components is a claim that will
 * eventually be four slightly different claims. One definition, imported.
 *
 * NO next-intl HERE, DELIBERATELY. Only the patient portal is required to be bilingual
 * (`docs/30-architecture/frontend-nextjs.md` §210, AC 8). The staff surfaces are English
 * and plain strings are the correct choice; adding a translation layer to this app would
 * be work with no reader.
 */

/* ============================================================================
   SENTENCES THE PRODUCT IS BOUND TO
   ============================================================================ */

/**
 * The non-custodial sentence, §H1.5, on the screen where the money is configured.
 *
 * A sales asset as much as a compliance statement: clinic owners are rightly suspicious of
 * software that touches their money, and this is the only place the person entering the
 * credentials can read what is actually true.
 */
export const NON_CUSTODIAL =
  'Money goes from your patient to your account. Carevelo never holds it and cannot access it.'

/**
 * §H1.3, and the UI "must say so in plain words".
 *
 * Carevelo has no access to the UMDPC or NDA registers and must never imply that a
 * recorded reference has been checked — that implication would be both false and, if
 * relied upon, harmful.
 */
export const NOT_VERIFIED_BY_CAREVELO =
  'These references are recorded as this clinic\'s own attestation. Carevelo has no access to '
  + 'the UMDPC or NDA registers, has not checked them, and does not verify licences.'

/** The same statement for a practitioner's registration, which is a separate register again. */
export const REGISTRATION_NOT_VERIFIED =
  'Recorded as the clinic\'s own attestation. Carevelo has no access to the UMDPC, AHPC or '
  + 'Nurses & Midwives registers and does not check registration numbers.'

/**
 * §H1.1 and `docs/20-domain/identifiers-and-numbering.md`, and the UI must say it.
 *
 * The subdomain appears in patient-facing links, in the aggregator's webhook configuration
 * and on printed materials. `UpdateTenantRequest` declares it `prohibited` rather than
 * merely omitting it, so an attempt to change it produces this explanation rather than a
 * silent discard — and the screen renders it read-only so the attempt is never made.
 */
export const SUBDOMAIN_IS_FIXED =
  'The clinic\'s address is fixed when the clinic is provisioned and cannot be changed. It '
  + 'appears in patient-facing links, in your aggregator\'s webhook configuration and on '
  + 'printed materials. A clinic that rebrands is given a custom domain instead.'

/* ============================================================================
   LABELS
   ============================================================================ */

/**
 * Roles, in the words a clinic administrator uses.
 *
 * Roles and not permissions. The RBAC matrix is the contract, and a console that reasons
 * about individual permissions drifts from it — so these are labels for the six values the
 * API accepts and nothing more.
 */
export const ROLE_LABELS: Record<StaffRole, string> = {
  clinic_admin: 'Administrator',
  clinician: 'Clinician',
  pharmacist: 'Pharmacist',
  dispatcher: 'Dispatcher',
  front_desk: 'Front desk',
  rider: 'Rider',
}

/** The order the roles are offered in: the ones a clinic needs first, first. */
export const ROLE_ORDER: readonly StaffRole[] = [
  'clinician',
  'front_desk',
  'pharmacist',
  'dispatcher',
  'rider',
  'clinic_admin',
]

/**
 * Consultation modes.
 *
 * Voice and chat are FIRST-CLASS CHOICES, not fallbacks — a patient on a 2G connection in
 * a rural district is the ordinary case rather than the degraded one, and the labels say
 * so plainly instead of implying video is the real thing.
 */
export const MODE_LABELS: Record<ConsultationMode, string> = {
  in_person: 'At the clinic',
  video: 'Video call',
  voice: 'Voice call',
  chat: 'Chat',
}

export const MODE_ORDER: readonly ConsultationMode[] = ['in_person', 'video', 'voice', 'chat']

/** The three registers a Ugandan practitioner may be on. */
export const REGISTRATION_BODY_LABELS: Record<RegistrationBody, string> = {
  umdpc: 'Uganda Medical and Dental Practitioners Council (UMDPC)',
  ahpc: 'Allied Health Professionals Council (AHPC)',
  nurses_midwives: 'Uganda Nurses and Midwives Council',
}

/**
 * What an aggregator status means to the person reading it.
 *
 * `unconfigured` is deliberately not called a problem. It is a working state, and a
 * console that renders it as a blocking error is a clinic that stops booking patients over
 * a feature it has chosen not to use.
 */
export function aggregatorStatusLabel(status: string): string {
  switch (status) {
    case 'unconfigured':
      return 'Not connected'
    case 'pending_verification':
      return 'Awaiting verification'
    case 'active':
      return 'Connected'
    case 'failing':
      return 'Refused by the aggregator'
    default:
      return status
  }
}

/** Good, warn or bad — never a colour alone, and never a colour without a word beside it. */
export function aggregatorTone(account: AggregatorAccount): 'good' | 'warn' | 'neutral' | 'bad' {
  switch (account.status) {
    case 'active':
      return account.accepts_online_payment ? 'good' : 'warn'
    case 'failing':
      return 'bad'
    case 'pending_verification':
      return 'warn'
    default:
      return 'neutral'
  }
}

/* ============================================================================
   THE CLINIC'S OWN NAME
   ============================================================================ */

/**
 * What to call the clinic on screen.
 *
 * `trading_name` is what patients see and what staff say out loud. It is `string` on the
 * public resource and can still be empty on a clinic that has not been through branding
 * yet, which is exactly the clinic most likely to be reading these screens.
 */
export function clinicName(clinic: Clinic | null | undefined): string {
  const name = clinic?.trading_name?.trim()

  return name && name !== '' ? name : 'this clinic'
}

/* ============================================================================
   FEEDBACK, CARRIED ON THE URL
   ============================================================================ */

/**
 * Why a save reports through the URL rather than through a return value.
 *
 * A Server Action ends in `redirect()`, and a redirect cannot carry a value back to the
 * screen it came from. The alternative is `useActionState`, which makes the form a client
 * component — and these forms must post NATIVELY, before any bundle arrives and with
 * JavaScript switched off entirely. So the outcome travels as an ordinary search
 * parameter, the same way the patient portal's payment chooser carries its `error`.
 *
 * The parameters are read back out with `first()` and `all()` below rather than trusted,
 * because a search parameter is a value from the far side of the wire: Next types them
 * `string | string[] | undefined`, and a screen that assumed `string` renders `[object
 * Object]` the first time somebody repeats the key in the address bar.
 */

/** One value from a search parameter, whatever shape Next handed over. */
export function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

/** Every value from a search parameter, as a list. */
export function all(value: string | string[] | undefined): readonly string[] {
  if (Array.isArray(value)) {
    return value
  }

  return value === undefined ? [] : [value]
}

/**
 * A path on this origin, or the fallback.
 *
 * `redirect()` will happily send somebody to another origin, and an open redirect on a
 * screen that handles merchant credentials is a phishing kit with the clinic's own name on
 * it. Every path in this domain arrives as an encrypted bound argument — so it cannot be
 * edited in the page — and is checked here anyway, because a control that costs one line
 * is worth having twice.
 *
 * `//evil.example` is a protocol-relative URL and a browser follows it off-site, so the
 * double slash is refused explicitly rather than caught by the leading-slash test.
 */
export function samePath(candidate: string, fallback: string): string {
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : fallback
}

/**
 * The same path, carrying what the screen has to say — preserving any query it already had.
 *
 * A `null` value removes the key, which is what makes a successful save clear the problem
 * that sent the administrator back here in the first place.
 */
export function withParams(
  path: string,
  params: Record<string, string | readonly string[] | null>,
): string {
  const url = new URL(path, 'https://console.invalid')

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.delete(key)

    if (value === null) {
      continue
    }

    for (const entry of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, entry)
    }
  }

  return `${url.pathname}${url.search}`
}

/** One colleague's path, from the template the route layer supplied. */
export function staffMemberPath(template: string, userId: string): string {
  return template.replace('{user}', encodeURIComponent(userId))
}

/* ============================================================================
   FAILED READS
   ============================================================================ */

export type AccessProblem = {
  /** What to put at the top of the panel. */
  title: string
  /** The sentence under it. */
  body: string
  tone: 'warn' | 'bad'
}

/**
 * What a failed read means to the person looking at the screen.
 *
 * THREE FAILURES THAT NEED THREE DIFFERENT ANSWERS, which is why `Attempt` carries the
 * status and not only the sentence:
 *
 *   - 401: the session ended. Nothing on the screen is wrong; they need to sign in again.
 *   - 403: they are signed in and are not an administrator. Every endpoint in this domain
 *     is `clinic_admin` only, and a clinician who follows a link to /settings should be
 *     told plainly rather than shown an empty page that looks broken.
 *   - anything else, including no response at all: our problem, and it must not be
 *     disguised as either of the above.
 *
 * The API's own sentence is preferred where there is one; `humanise()` has already written
 * a serviceable one for each status. The fallback is used when the request never reached
 * the API, where there is nothing to pass on and inventing detail about a failure we did
 * not observe is how a support call starts.
 */
export function accessProblem(failure: Extract<Attempt<unknown>, { ok: false }>): AccessProblem {
  if (failure.status === 401) {
    return {
      title: 'Your session has ended',
      body: failure.message ?? 'Sign in again to reach this clinic\'s settings.',
      tone: 'warn',
    }
  }

  if (failure.status === 403) {
    return {
      title: 'Administrators only',
      body:
        'Clinic settings are reachable by a clinic administrator and by nobody else. Ask an '
        + 'administrator at this clinic to make the change, or to give you the role.',
      tone: 'warn',
    }
  }

  return {
    title: 'This did not load',
    body:
      failure.message
      ?? 'The request did not reach Carevelo. Check the connection and try again — nothing has '
        + 'been changed.',
    tone: 'bad',
  }
}

/* ============================================================================
   READING A SUBMITTED FORM
   ============================================================================ */

/**
 * One text field from a native form post.
 *
 * `FormData.get()` returns `File | string | null`, and a screen that assumed `string`
 * would render a File object's `toString()` into a clinic's record the first time somebody
 * pointed a file input at a field of that name. Anything that is not a string is `null`,
 * which every caller already handles because a field can legitimately be absent.
 */
export function text(formData: FormData, name: string): string | null {
  const value = formData.get(name)

  return typeof value === 'string' ? value : null
}

/**
 * A trimmed text field, or `null` where the administrator left it empty.
 *
 * A box containing three spaces is an empty box. Sending it would store three spaces as a
 * clinic's trading name, and every screen downstream would render an invisible name.
 */
export function trimmed(formData: FormData, name: string): string | null {
  const value = text(formData, name)?.trim()

  return value === undefined || value === '' ? null : value
}

/**
 * Whether a checkbox was ticked.
 *
 * An unticked checkbox is ABSENT from a form post rather than present and false — which is
 * a fact about HTML rather than about this product, and the single commonest way a "leave
 * it switched on" setting silently switches itself off. Every boolean in this domain goes
 * through here so that fact is stated once.
 */
export function checked(formData: FormData, name: string): boolean {
  return formData.get(name) !== null
}

/** Every value of a repeated field — a checkbox group, for instance. */
export function every(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === 'string')
}
