import type { components } from '@carevelo/api-client'

/**
 * What the operator in front of this browser is allowed to do, derived from the role
 * NAMES that `GET /v1/me` returns.
 *
 * ------------------------------------------------------------
 * THIS IS AN AFFORDANCE, NOT A CONTROL, AND THE DIFFERENCE MATTERS
 *
 * Nothing in this file protects anything. Authorisation happens three times on the API —
 * ability, policy, row-level security — and a hidden button is not a fourth layer, it is
 * a courtesy. What it buys is honesty: `platform_support` is READ-ONLY on the tenant
 * register, and showing them a Suspend button that answers 403 teaches them that the
 * product is unreliable rather than that they lack the permission.
 *
 * The consequence is the rule this file follows: every capability below is derived from a
 * role, never from a UI state, and every screen that hides a control also SAYS why it is
 * hidden. A control that vanishes without explanation is indistinguishable from a bug.
 *
 * ------------------------------------------------------------
 * WHERE THE SPLIT COMES FROM
 *
 * docs/50-security-compliance/rbac-matrix.md, § Administration:
 *
 *   Tenant — provision / suspend    platform_support —   platform_admin ✓
 *   Tenant — data export            platform_support —   platform_admin ✓
 *   Break-glass — request           platform_support ✓   platform_admin ✓
 *   Audit log — read                platform_support metadata   platform_admin metadata
 *
 * SUBSCRIPTION BILLING SPLITS ACROSS THAT LINE RATHER THAN SITTING ON ONE SIDE OF IT, and
 * the split is the API's own. Reading a clinic's plan and paid-through date is `viewAny` —
 * the register's ability, both roles — because support is asked "is this clinic paid up?"
 * constantly and can answer it from metadata alone. Recording a price and starting a
 * collection are `TenantPolicy::update`, `platform_admin` only, alongside suspension: they
 * are the acts that change what a clinic owes and whether Pesapal charges it.
 *
 * Break-glass is deliberately available to BOTH, and it is worth understanding why rather
 * than reading it as an oversight: support is the role that meets the incident first, and
 * a control that forces an escalation before anything can be looked at produces either a
 * delay in front of a patient or a shared login. Both roles reach it, both are time-boxed,
 * both notify the clinic and both are audited.
 *
 * `break_glass` ITSELF IS A ROLE and is deliberately absent from the union below. It is
 * granted temporarily by the grant, it confers clinical read access inside the tenant's
 * own surfaces, and it confers nothing on this screen. Treating it as a platform role here
 * would let an active grant quietly widen what its holder can do to the register.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */

/** Who is signed in, straight from the contract. Never hand-written. */
export type Operator = components['schemas']['MeResource']

/** The two standing platform roles. Nothing temporary belongs in this union — see above. */
export type PlatformRole = 'platform_admin' | 'platform_support'

const PLATFORM_ROLES = new Set<string>(['platform_admin', 'platform_support'])

/**
 * What the screens may offer.
 *
 * Named for the ACT rather than for the role, so a screen reads "if the operator may
 * provision" and not "if the operator is an admin". The day a third platform role exists,
 * this file changes and no screen does.
 */
export type Capabilities = {
  /** The tenant register itself. Both roles; it is the surface support works from. */
  readonly readRegister: boolean
  /** `POST /v1/platform/tenants`. */
  readonly provision: boolean
  /** `PATCH /v1/platform/tenants/{tenant}` — suspend, resume, begin offboarding, trial. */
  readonly changeLifecycle: boolean
  /** `POST /v1/platform/tenants/{tenant}/export` — the controller-obligation export. */
  readonly exportTenantData: boolean
  /** `POST /v1/platform/break-glass`. Both roles. */
  readonly requestBreakGlass: boolean
  /**
   * `GET /v1/platform/tenants/{tenant}/subscription`. BOTH ROLES, and that is the API's
   * choice rather than a relaxation made here: the controller authorises with `viewAny` —
   * the same ability as the register itself — because "is this clinic paid up?" is a
   * metadata question support fields all day and can answer without touching anything
   * clinical.
   */
  readonly readBilling: boolean
  /**
   * `PUT .../subscription` and `POST .../subscription/collect`. `platform_admin` alone.
   *
   * ONE CAPABILITY FOR TWO ENDPOINTS, because there is one ability behind them:
   * `TenantPolicy::update`, the same gate as suspending a clinic. Two capabilities derived
   * from one ability would be two things to keep in step with one, and the day the policy
   * changed only one of them would follow.
   *
   * The endpoints stay separate for a reason this app has to honour even though the
   * capability does not distinguish them: recording a commercial agreement and asking
   * Pesapal for money are different acts, and a support operator correcting a typo in a
   * price must not thereby charge a clinic. There is no "save and collect" control anywhere
   * in this app.
   */
  readonly administerBilling: boolean
}

const NOTHING: Capabilities = {
  readRegister: false,
  provision: false,
  changeLifecycle: false,
  exportTenantData: false,
  requestBreakGlass: false,
  readBilling: false,
  administerBilling: false,
}

/** The roles on this account that are platform roles, in the order the API listed them. */
export function platformRoles(operator: Operator): readonly PlatformRole[] {
  return operator.roles.filter((role): role is PlatformRole => PLATFORM_ROLES.has(role))
}

/**
 * Capabilities for a set of roles.
 *
 * ADDITIVE, because an account can hold both roles and the matrix grants by role rather
 * than by seniority. An operator who is both support and admin gets the union, which is
 * what "admin" already means; an operator who is neither gets nothing, which is the
 * default this function starts from rather than a case it remembers to handle.
 */
export function capabilitiesFor(roles: readonly string[]): Capabilities {
  const has = (role: PlatformRole) => roles.includes(role)
  const admin = has('platform_admin')
  const support = has('platform_support')

  if (!admin && !support) {
    return NOTHING
  }

  return {
    readRegister: true,
    provision: admin,
    changeLifecycle: admin,
    exportTenantData: admin,
    requestBreakGlass: true,
    readBilling: true,
    administerBilling: admin,
  }
}

/**
 * The three states a request to this app can be in, resolved once and handed to the route.
 *
 * `guest` AND `no-role` ARE DELIBERATELY DIFFERENT and neither is a 404. The
 * "cross-tenant reads are 404, never 403" rule is about records: a 403 on a record
 * confirms it exists somewhere, which is how you learn that a named person is a patient
 * of some clinic. Neither of these discloses anything about anybody — one says the
 * browser has no session, the other says this account has no platform role — and
 * flattening them into a 404 would leave an operator whose session simply expired
 * believing the console had been taken away from them.
 */
export type Access =
  | { readonly kind: 'guest' }
  | { readonly kind: 'no-role'; readonly operator: Operator }
  | {
      readonly kind: 'operator'
      readonly operator: Operator
      readonly roles: readonly PlatformRole[]
      readonly can: Capabilities
    }
