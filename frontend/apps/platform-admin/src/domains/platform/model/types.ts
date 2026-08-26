import type { components, operations } from '@carevelo/api-client'

/**
 * Every shape this domain handles, taken from the generated contract.
 *
 * NOT ONE OF THESE IS HAND-WRITTEN, and the rule is not stylistic. A hand-written response
 * interface is a second copy of the contract that nothing checks, so it drifts the first
 * time the API adds a field and goes on compiling while the screen renders `undefined`.
 * `packages/api-client/src/generated/schema.d.ts` is generated from docs/40-api/openapi.yaml
 * and committed, so the day a field changes there, every call site in this folder stops
 * compiling — which is the entire point.
 *
 * THE HEALTH PAYLOAD AND THE EXPORT DOCUMENT HAVE NO NAMED SCHEMA, so they are reached
 * through `operations` rather than `components`. Both describe themselves inline in the
 * spec; indexing into the operation is how you take them from the contract instead of
 * retyping them here.
 */

/**
 * A clinic, as CAREVELO's control plane sees it.
 *
 * READ WHAT IS NOT ON THIS TYPE. There is no patient count, no consultation count, no
 * revenue figure and no aggregator credential — not omitted from the screens, absent from
 * the resource. Support answers "is this clinic provisioned, on trial, suspended,
 * offboarding" and cannot answer anything about a person, and the shape of this type is
 * what makes that true rather than a policy somebody remembers.
 *
 * The screens in this domain say so out loud, because an operator who does not know a
 * figure is deliberately unavailable will go looking for it in a database.
 */
export type Tenant = components['schemas']['PlatformTenantResource']

/** provisioning | active | suspended | offboarding | closed. */
export type TenantStatus = components['schemas']['TenantStatus']

/** The provisioning body, exactly as `POST /v1/platform/tenants` accepts it. */
export type ProvisionBody = components['schemas']['StoreTenantRequest']

/**
 * The lifecycle body, exactly as `PATCH /v1/platform/tenants/{tenant}` accepts it.
 *
 * TWO FIELDS, AND THAT IS THE WHOLE COMMERCIAL SURFACE. `status` and `trial_ends_at`.
 * There is no plan, no price, no invoice and no subscription anywhere in this contract, so
 * there is no billing screen in this app and building one would mean inventing a model the
 * API does not have.
 */
export type LifecycleBody = components['schemas']['UpdateTenantRequest']

type TenantIndex =
  operations['v1.platform.tenants.index']['responses'][200]['content']['application/json']

/**
 * A page of the register.
 *
 * CURSOR, NOT OFFSET. Clinics are provisioned and suspended while somebody is paging
 * through the register, and that is precisely the traffic under which an offset duplicates
 * and skips rows. A skipped row here is a clinic nobody notices is suspended.
 */
export type TenantsPage = TenantIndex

export type TenantQuery = NonNullable<
  operations['v1.platform.tenants.index']['parameters']['query']
>

type HealthResponse =
  operations['v1.platform.health']['responses'][200]['content']['application/json']

/**
 * Counts and one security assertion. No clinic is singled out and nothing here is about a
 * person — which is what makes it safe to put on the landing screen.
 */
export type Health = HealthResponse['data']

type ExportResponse =
  operations['v1.platform.tenants.export']['responses'][200]['content']['application/json']

/**
 * The controller-obligation export document.
 *
 * `format` is a constant in the contract — `carevelo.tenant-export.v1` — which is what
 * lets the file this app hands over be identified later by something that has never seen
 * this app.
 */
export type TenantExport = ExportResponse['data']

/**
 * Where the route layer has mounted this domain's screens.
 *
 * PASSED IN RATHER THAN GUESSED. This domain owns no routes and must not assume the URLs
 * it lives at — a hard-coded `/tenants` here is a domain that cannot be moved or mounted
 * twice. Every link and every post-submit redirect is built from this, which also means a
 * Server Action can never be talked into redirecting somewhere a form told it to. The one
 * thing an action must never do is take its destination from the request.
 */
export type PlatformPaths = {
  /** Where the overview is mounted. */
  overview: string
  /** Where the register is mounted. Receives `?status=&cursor=&tenant=&problem=&message=`. */
  register: string
  /** Where the provisioning form is mounted. Receives `?problem=&message=`. */
  provision: string
  /** The Route Handler that turns an export into a file. Accepts a POST and nothing else. */
  export: string
  /** Where the break-glass domain is mounted, for the one link between them. */
  breakGlass: string
  /**
   * Where the subscription register is mounted. Receives `?status=&cursor=&tenant=`.
   *
   * Separate from `register` on purpose. That screen answers "who are our clinics and what
   * lifecycle state are they in"; this one answers "who owes us money". They overlap in
   * their rows and in nothing else, and a single screen carrying both would make the
   * commercial question the operator opens the console for compete with an operational one.
   */
  billing: string
}

/**
 * What a write attempt did, as a CODE rather than a sentence.
 *
 * A Server Action cannot hand a value back to a form that posted natively, so the outcome
 * travels in the query string and the route passes it back in. A code rather than the
 * message itself, because each of these needs a different shape of response on the screen
 * and because a sentence assembled in an action is a sentence nobody can find later.
 */
export type PlatformProblem =
  | 'refused'
  | 'invalid'
  | 'incomplete'
  | 'not_found'
  | 'failed'
  | 'export_failed'
