import { humanise, type Problem } from '@carevelo/api-client'
import { postMultipart, readClient, writeClient } from './http'
import type {
  ChecklistItem,
  Clinic,
  ClinicAdminView,
  ClinicChanges,
  OnboardingChecklist,
} from '../model/types'

/**
 * The clinic record: reading it, editing it, and putting a logo on it.
 *
 * ------------------------------------------------------------------------------
 * THE GAP THIS FILE IS BUILT AROUND, STATED ONCE, HERE.
 *
 * There is no endpoint that READS `TenantAdminResource`. Verified against
 * `backend/routes/api.php` and against `docs/40-api/endpoint-catalogue.md`, which says it
 * outright: `GET /v1/tenant` is "Public read returns branding and contact only". The
 * administrator-only fields — legal name, subdomain, status, trial end, the two compliance
 * references, and `branding.contrast_advisories` — exist on the resource that `PATCH
 * /v1/tenant` and `POST /v1/tenant/logo` RETURN, and on nothing that can be fetched.
 *
 * The consequences run through every screen in this domain and are worth naming rather
 * than discovering:
 *
 *   1. The compliance screen cannot show the administrator what is already recorded. It
 *      renders empty boxes and says so in plain words, and `omitBlank()` below means a
 *      blank box leaves the stored value alone rather than erasing it.
 *   2. The contrast advisories cannot be shown on arrival. They are shown after a save,
 *      carried back on the redirect — see `components/screen.ts`.
 *   3. The subdomain and the clinic's status are read from the ONBOARDING CHECKLIST, which
 *      does carry `tenant_status`, and from the request host, which is where the subdomain
 *      is visible anyway.
 *
 * WHAT WAS DELIBERATELY NOT DONE: a no-op `PATCH` to read the resource back. It would
 * work, and it would write an audit event, and `TenantAdminController::update()` calls
 * `activateWhenReady()` — so rendering a settings page could move a clinic from
 * `provisioning` to `active`. A read that changes a tenant's lifecycle state is not a read.
 *
 * THE FIX IS ONE ROUTE: `GET /v1/tenant/admin`, or a caller-aware `TenantController::show`.
 * Until then this file is as honest as it can be about what it cannot see.
 */

/**
 * The clinic as the patient portal sees it.
 *
 * Public, and that is what makes it usable here: the branding it returns is the RESOLVED
 * token set — colours plus the computed foregrounds plus the derived surface plus the logo
 * URL — which is exactly what the live preview has to mirror. A preview built from raw
 * colours and a foreground of our own choosing would be showing the administrator a portal
 * that does not exist.
 */
export async function getClinic(): Promise<Clinic> {
  const client = await readClient()
  const response = await client.get<{ data: Clinic }>('/v1/tenant')

  return response.data
}

/**
 * Branding, contact details and compliance references.
 *
 * Every field is `sometimes` on the backend, so the body carries only what the
 * administrator actually changed — which is the only reason a form that cannot show the
 * stored compliance references is safe to submit at all. See `omitBlank`.
 *
 * The subdomain is not here and cannot be: `UpdateTenantRequest` declares it `prohibited`
 * rather than merely omitting it, so an attempt to change it comes back as a sentence
 * explaining why instead of being silently discarded. This domain never sends it.
 */
export async function saveClinic(changes: ClinicChanges): Promise<ClinicAdminView> {
  const client = await writeClient()
  const response = await client.patch<{ data: ClinicAdminView }>('/v1/tenant', changes)

  return response.data
}

/**
 * Replace the clinic's logo.
 *
 * Multipart, so it goes through `postMultipart` rather than `ApiClient` — see the note
 * there. The failure path is spelled out by hand for the same reason: `ApiClient` is what
 * normally turns an RFC 9457 body into a sentence, and this call bypasses it, so the
 * translation has to happen here rather than being quietly skipped.
 *
 * The upload is decoded and RE-ENCODED server-side, which is worth knowing on this side
 * too: nothing here needs to inspect the file, strip metadata or check dimensions, and
 * anything it did check would be a second opinion about a claim the uploader made. The
 * only client-side hint is `accept` on the input, which is a convenience for the file
 * picker and never a control.
 */
export async function uploadLogo(
  file: File,
): Promise<{ ok: true; clinic: ClinicAdminView } | { ok: false; status: number; message: string }> {
  const form = new FormData()
  form.append('logo', file)

  const { status, body } = await postMultipart('/v1/tenant/logo', form)

  if (status >= 200 && status < 300) {
    return { ok: true, clinic: (body as { data: ClinicAdminView }).data }
  }

  return { ok: false, status, message: humanise(status, (body ?? {}) as Problem) }
}

/**
 * What remains before the clinic is live.
 *
 * NARROWED AT RUNTIME, NOT ASSERTED. `model/types.ts` widens four fields the generator got
 * wrong; widening a type is a claim about the shape, and this is the one place that claim
 * meets a real payload. An item that does not look like an item is DROPPED rather than
 * rendered half-empty — a checklist line with no label is worse than one fewer line,
 * because the administrator would be looking at a blank row and wondering what they had
 * missed.
 *
 * `is_complete` is compared against `true` and against the strings the JSON encoder can
 * produce for a boolean, and everything else counts as NOT complete. That direction is
 * deliberate: a checklist that wrongly ticks a gate tells a clinic it is ready to see
 * patients when it is not.
 */
export async function getChecklist(): Promise<OnboardingChecklist> {
  const client = await readClient()
  const response = await client.get<{ data: unknown }>('/v1/tenant/onboarding-checklist')

  return narrowChecklist(response.data)
}

function narrowChecklist(data: unknown): OnboardingChecklist {
  const raw = (data ?? {}) as Record<string, unknown>
  const items = Array.isArray(raw.items) ? raw.items : []

  const narrowed = items
    .map(narrowChecklistItem)
    .filter((item): item is ChecklistItem => item !== null)

  return {
    tenant_status: typeof raw.tenant_status === 'string' ? raw.tenant_status : 'provisioning',
    items: narrowed,
    is_ready_to_activate: raw.is_ready_to_activate === true,
    note: typeof raw.note === 'string' ? raw.note : '',
  }
}

function narrowChecklistItem(value: unknown): ChecklistItem | null {
  const item = (value ?? {}) as Record<string, unknown>

  if (typeof item.key !== 'string' || typeof item.label !== 'string') {
    return null
  }

  return {
    key: item.key,
    label: item.label,
    is_complete: isTrue(item.is_complete),
    is_required: item.is_required === true,
    detail: typeof item.detail === 'string' && item.detail !== '' ? item.detail : null,
  }
}

/** `true`, or one of the strings a boolean can arrive as. Everything else is false. */
function isTrue(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1
}

/**
 * Drop the fields the administrator left blank.
 *
 * THIS IS THE CONTROL THAT MAKES A FORM WITH NO READ-BACK SAFE. The compliance screen
 * cannot show what is stored, so every box on it opens empty — and a body carrying
 * `umdpc_facility_reference: null` because a box was empty would erase a reference the
 * clinic recorded last month, on a screen that never showed it to them.
 *
 * `sometimes` on the backend means an absent key is left alone, so absence is exactly the
 * semantics wanted. The cost is that a value cannot be CLEARED through this path, and that
 * cost is stated on the screen rather than hidden: of the two possible mistakes — a
 * reference that cannot be deleted, and a reference deleted by accident — only one of them
 * loses something the clinic cannot get back from us.
 */
export function omitBlank(fields: Record<string, string | null>): ClinicChanges {
  const changes: Record<string, string> = {}

  for (const [key, value] of Object.entries(fields)) {
    const trimmed = (value ?? '').trim()

    if (trimmed !== '') {
      changes[key] = trimmed
    }
  }

  return changes as ClinicChanges
}
