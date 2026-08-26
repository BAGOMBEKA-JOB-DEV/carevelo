/**
 * The platform domain's PUBLIC SURFACE.
 *
 * Carevelo's own control plane: the register of clinics, provisioning, the lifecycle,
 * the controller-obligation export, and system health. Everything else in this folder is
 * internal — the HTTP calls, the status vocabulary, the URL building — and
 * `.dependency-cruiser.cjs` makes reaching past this file a build failure rather than a
 * code-review note.
 *
 * ------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 * Three screens, each a server component that fetches its own data and degrades to a
 * notice rather than throwing. A route authorises with `authoriseOperator()` from the
 * identity domain, mounts one inside `<ControlPlaneShell>`, and passes:
 *
 *   <OverviewScreen       paths />
 *   <TenantRegisterScreen paths can status cursor tenant problem message provisioned />
 *   <ProvisionScreen      paths problem message fields />
 *
 * Everything after `can` is read straight out of `searchParams` and passed through — the
 * screens own the meaning, the route only carries the values. `can` is `access.can`, and it
 * is an AFFORDANCE rather than a control: the API authorises three times over and a hidden
 * button is not a fourth layer. What it buys is honesty about which role is needed.
 *
 * `paths` is `PlatformPaths` — where the route layer has mounted these screens. This domain
 * hard-codes no URL, so a Server Action can never be talked into redirecting somewhere a
 * form told it to.
 *
 * ------------------------------------------------------------
 * THREE THINGS THIS DOMAIN DELIBERATELY DOES NOT HAVE
 *
 * NO BILLING. There is no subscription, plan, price or invoice model anywhere in
 * docs/40-api/openapi.yaml. `UpdateTenantRequest` carries `status` and `trial_ends_at` and
 * says why in its own description: "COMMERCIAL fields only." Those two fields are the whole
 * commercial surface, and a billing screen here would be a model this product does not have,
 * drawn convincingly enough for somebody to act on.
 *
 * NO CLINICAL ANYTHING. `PlatformTenantResource` carries no patient count, no consultation
 * count and no aggregator credential. The screens state that rather than leaving an operator
 * to assume the figures are elsewhere and go looking in a database.
 *
 * NO SINGLE-TENANT FETCH. The contract publishes index, store, update and export, and no
 * show, so the detail panel opens from a row the register already loaded. Reported as a gap;
 * the alternative was a client-side table scan that gets slower with every clinic Carevelo
 * signs.
 */

/* ---- Screens ---- */
export { OverviewScreen } from './components/OverviewScreen'
export {
  TenantRegisterScreen,
  type TenantRegisterScreenProps,
} from './components/TenantRegisterScreen'
export { ProvisionScreen, type ProvisionScreenProps } from './components/ProvisionScreen'
/* The subscription register — who owes us money, as distinct from who our clinics are. */
export {
  BillingRegisterScreen,
  type BillingRegisterScreenProps,
} from './components/BillingRegisterScreen'

/* ---- Reads and writes, for the route layer and for the break-glass domain ----
   `listTenants` and `getHealth` throw `ApiError` on failure; the screens above catch for
   themselves, and a caller outside this domain is expected to decide what a failure means
   on its own surface. The two write functions never throw — they return an outcome. */
export { listAllTenants, listTenants, exportTenant, provisionTenant, updateTenant } from './api/tenants'
export type { ExportOutcome, TenantOutcome } from './api/tenants'
export { getHealth } from './api/health'

/* ---- Types, all of them from the generated contract ---- */
export type {
  Health,
  LifecycleBody,
  PlatformPaths,
  PlatformProblem,
  ProvisionBody,
  Tenant,
  TenantExport,
  TenantQuery,
  TenantStatus,
  TenantsPage,
} from './model/types'
