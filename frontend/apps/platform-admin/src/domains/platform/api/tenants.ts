import { ApiError } from '@carevelo/api-client'
import { readClient, writeClient } from '@/domains/identity'
import type {
  LifecycleBody,
  PlatformProblem,
  ProvisionBody,
  Tenant,
  TenantExport,
  TenantQuery,
  TenantsPage,
} from '../model/types'

/**
 * The tenant register: reading it, provisioning into it, moving a clinic through its
 * lifecycle, and producing the controller-obligation export.
 *
 * ------------------------------------------------------------
 * THERE IS NO `GET /v1/platform/tenants/{tenant}` AND THAT SHAPES THE SCREENS
 *
 * The contract publishes index, store, update and export — and no show. So there is no
 * function here that fetches one clinic by id, because there is no endpoint to write it
 * against, and a function that paged through the index looking for a match would be a
 * client-side table scan pretending to be a read.
 *
 * What the register screen does instead is state it plainly: the detail panel opens for a
 * clinic on the page currently in view, from the row already loaded. It is reported as a
 * gap rather than worked around, because the workaround gets slower with every clinic
 * Carevelo signs and fails silently at page two.
 *
 * ------------------------------------------------------------
 * NOTHING HERE ACCEPTS A TENANT FROM A FORM EXCEPT WHERE THE CONTRACT DOES
 *
 * Everywhere else in this API tenancy comes from the host or the session and a
 * client-supplied tenant is the shape of a cross-tenant read attempt. These endpoints are
 * the deliberate exception — a cross-tenant control surface has no host to read it from —
 * and the tenant is named in the PATH, which is why the value passed to `updateTenant` and
 * `exportTenant` is always an id the register itself produced rather than one a form typed.
 *
 * @see docs/40-api/openapi.yaml — /v1/platform/tenants
 * @see docs/50-security-compliance/rbac-matrix.md § Administration
 */

/**
 * A page of the register.
 *
 * CURSOR, NOT OFFSET, and this function has no page-number parameter to make that
 * accidental. Clinics are being provisioned and suspended while an operator pages through,
 * which is precisely the traffic under which an offset duplicates and skips rows.
 */
export async function listTenants(query: TenantQuery = {}): Promise<TenantsPage> {
  const client = await readClient()

  return client.get<TenantsPage>('/v1/platform/tenants', {
    query: {
      status: query.status,
      per_page: query.per_page,
      cursor: query.cursor,
    },
  })
}

/**
 * Every clinic on one page, for a control that has to name one — the break-glass tenant
 * picker above all.
 *
 * `per_page` IS THE CONTRACT'S MAXIMUM AND THAT IS A CEILING, NOT A DESIGN. A picker built
 * on this shows the first hundred clinics and no more, so the caller is handed
 * `complete: false` when there is another page and is expected to say so on screen rather
 * than present a truncated list as though it were the register. The endpoint offers no
 * search parameter; when Carevelo passes a hundred clinics this needs one, and until then
 * the honest thing is a visible limit.
 */
export async function listAllTenants(): Promise<{
  readonly tenants: readonly Tenant[]
  readonly complete: boolean
}> {
  const page = await listTenants({ per_page: 100 })

  return { tenants: page.data, complete: page.meta.next_cursor === null }
}

/** What a write attempt did, with no exception left for the caller to interpret. */
export type TenantOutcome =
  | { kind: 'done'; tenant: Tenant }
  | { kind: 'problem'; problem: PlatformProblem; message: string | null; fields: Record<string, string> }

/**
 * Provision a clinic.
 *
 * CREATED IN `provisioning`, NEVER `active`, and `StoreTenantRequest` has no `status` field
 * for a caller to try — the contract's own note says so. What follows is a product fact the
 * form has to state rather than a limitation to apologise for: the clinic becomes active by
 * completing its own checklist, so there is no switch on this surface that opens a clinic
 * for business.
 *
 * THE SUBDOMAIN IS THE FIELD TO GET RIGHT. It appears in patient-facing URLs, in the
 * aggregator's webhook configuration and on printed materials, and it is immutable
 * afterwards — so a clinic that claims `api` or `admin` does not merely have an awkward
 * name, it shadows a platform host. Whether a given value is acceptable is the API's
 * decision and not restated here; a second copy of that list would be a second copy free to
 * disagree with the first.
 */
export async function provisionTenant(body: ProvisionBody): Promise<TenantOutcome> {
  try {
    const client = await writeClient()
    const response = await client.post<{ data: Tenant }>('/v1/platform/tenants', body)

    return { kind: 'done', tenant: response.data }
  } catch (error) {
    return { kind: 'problem', ...diagnose(error) }
  }
}

/**
 * Suspend, resume, begin offboarding, or move the trial.
 *
 * NO TRANSITION TABLE IS RESTATED HERE, DELIBERATELY. `TenantStatus` on the API decides
 * which moves are legal and throws otherwise, and the contract says as much: "a state
 * machine with its transitions restated in a form request has two definitions and one of
 * them will drift." The same argument applies with more force in a browser, which is
 * further from the machine. So the screen offers the states and the API refuses the ones
 * that are not reachable, in its own words, which the caller shows unchanged.
 *
 * WHAT SUSPENSION IS NOT. It blocks staff sign-in. It does not stop a patient reading their
 * own records, it does not abandon a delivery already in flight, and it can never withhold
 * the export. Nothing in this body could make it do any of those, and the screen that calls
 * this says so before the operator commits.
 */
export async function updateTenant(id: string, body: LifecycleBody): Promise<TenantOutcome> {
  try {
    const client = await writeClient()
    const response = await client.patch<{ data: Tenant }>(
      `/v1/platform/tenants/${encodeURIComponent(id)}`,
      body,
    )

    return { kind: 'done', tenant: response.data }
  } catch (error) {
    return { kind: 'problem', ...diagnose(error) }
  }
}

export type ExportOutcome =
  | { kind: 'done'; document: TenantExport }
  | { kind: 'problem'; problem: PlatformProblem; message: string | null }

/**
 * The controller-obligation export.
 *
 * REACHABLE FOR A SUSPENDED TENANT, AND THAT IS LOAD-BEARING. The clinic is the data
 * controller and leaves with its data REGARDLESS of any commercial dispute; withholding it
 * to secure payment would be unlawful and would harm patients. The contract states there is
 * no status check on this endpoint and that there must never be one — so there is no status
 * check in front of it here either, and no screen in this app hides the button on a
 * suspended clinic.
 *
 * AUDITED TWICE, ON PURPOSE: once in the platform trail and once in the clinic's own, so
 * the clinic can see that the export happened even when somebody else asked for it. That is
 * why this is only ever reached by a POST — a GET that an operator's browser could prefetch,
 * or a crawler could follow, would write audit entries nobody asked for into a clinic's own
 * trail.
 *
 * AGGREGATOR CREDENTIALS ARE NOT IN IT and the document says so in an `excluded` block
 * rather than leaving the clinic to discover the gap later. They are unreadable by every
 * role including this one, and the clinic holds them already — they are the clinic's own
 * credentials at the clinic's own aggregator.
 */
export async function exportTenant(id: string): Promise<ExportOutcome> {
  try {
    const client = await writeClient()
    const response = await client.post<{ data: TenantExport }>(
      `/v1/platform/tenants/${encodeURIComponent(id)}/export`,
    )

    return { kind: 'done', document: response.data }
  } catch (error) {
    const { problem, message } = diagnose(error)

    return { kind: 'problem', problem, message }
  }
}

/**
 * Which of the things that can go wrong went wrong.
 *
 * A 404 IS PASSED THROUGH UNTOUCHED AND NOT EXPLAINED. On these endpoints it means the
 * clinic is not there — most likely a stale row in a register somebody left open — and the
 * caller says exactly that. It is not turned into a 403 and a 403 is not turned into a 404:
 * this is Carevelo's own control plane, both answers are about Carevelo's own permissions,
 * and the "cross-tenant reads are 404" rule is about not confirming that a RECORD exists to
 * somebody outside the tenant. There is nobody outside the tenant here.
 *
 * `fields` CARRIES THE API'S OWN PER-FIELD SENTENCES so the provisioning form can put each
 * one under the input it belongs to. `ApiError` has already put RFC 9457 problem details
 * through `humanise()`; nothing is rewritten, because the API is the authority on why it
 * refused and a paraphrase loses the part the operator can act on.
 */
function diagnose(error: unknown): {
  problem: PlatformProblem
  message: string | null
  fields: Record<string, string>
} {
  if (!(error instanceof ApiError)) {
    return { problem: 'failed', message: null, fields: {} }
  }

  if (error.status === 403) {
    return { problem: 'refused', message: error.message, fields: {} }
  }

  if (error.status === 404) {
    return { problem: 'not_found', message: error.message, fields: {} }
  }

  if (error.status === 422) {
    return { problem: 'invalid', message: error.message, fields: error.fieldErrors }
  }

  return { problem: 'failed', message: error.message, fields: {} }
}
