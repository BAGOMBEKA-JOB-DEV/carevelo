import { readingApi } from './gateway'
import type { AvailabilityMeta, Clinician, Patient, Service, Slot } from '../model/types'

/**
 * The three lists an assisted booking needs: what the clinic offers, who can deliver it,
 * and when.
 *
 * NONE OF THESE IS PAGINATED EXCEPT THE PATIENTS, and that asymmetry is the API's rather
 * than a choice made here. Services and clinicians are returned whole because a private
 * Ugandan clinic has a handful of each and a receptionist choosing one needs to see them
 * all; availability is a computed window, not a table. The patient registry is a cursor
 * page because it is the one list that grows without limit.
 */

/** Everything the clinic offers, active and withdrawn alike. */
export async function listServices(): Promise<Service[]> {
  const api = await readingApi()
  const response = await api.get<{ data: Service[] }>('/v1/services')

  return response.data
}

/**
 * The clinic's clinicians, alphabetically.
 *
 * `is_active` is applied server-side, so a clinician who has left is already absent. That is
 * worth knowing rather than re-filtering: an empty list here means the clinic has no
 * registered clinician, which is a genuine onboarding gap — availability is generated per
 * Clinician row, so no clinician means no slots, nothing to book, and no consultation.
 */
export async function listClinicians(): Promise<Clinician[]> {
  const api = await readingApi()
  const response = await api.get<{ data: Clinician[] }>('/v1/clinicians')

  return response.data
}

export type Availability = {
  slots: Slot[]
  meta: AvailabilityMeta
}

export type AvailabilityQuery = {
  /** Required. Without a service there is no slot length, and a guessed default would offer times the clinic never sized. */
  serviceId: string
  /** Absent means every clinician, which is what "whoever is free" asks for. */
  clinicianId?: string | undefined
  /** `YYYY-MM-DD`. */
  from?: string | undefined
  to?: string | undefined
}

/**
 * The slots the clinic can actually offer.
 *
 * ADVISORY, ALWAYS — see the note on `Slot`. What comes back is working hours minus busy
 * periods at the moment of asking, and booking re-checks inside a transaction. A screen
 * that treats one of these as reserved is a screen that shows a receptionist an error for
 * something that is not their fault.
 */
export async function listAvailability(query: AvailabilityQuery): Promise<Availability> {
  const api = await readingApi()
  const response = await api.get<{ data: Slot[]; meta: AvailabilityMeta }>('/v1/availability', {
    query: {
      service_id: query.serviceId,
      clinician_id: query.clinicianId,
      from: query.from,
      to: query.to,
    },
  })

  return { slots: response.data, meta: response.meta }
}

export type PatientPage = {
  patients: Patient[]
  nextCursor: string | null
}

/**
 * The clinic's patient registry, one page at a time.
 *
 * THERE IS NO SEARCH PARAMETER AND THAT IS NOT AN OVERSIGHT HERE. `v1.patients.index`
 * accepts exactly one filter, `status`, and nothing else — no name, no phone, no cursor
 * over a query. A front desk booking for a caller has to find that caller by name or by the
 * number they are speaking from, forty times a day, and today the only way is to page the
 * whole registry.
 *
 * WHAT THIS DOMAIN DOES ABOUT IT: pages, and filters the page in memory, and says so on the
 * screen rather than pretending the box is a server search. That is honest for a clinic
 * with a few hundred patients and visibly inadequate for one with ten thousand, which is
 * the correct shape for a gap that needs a one-line `where` clause on the API side. It is
 * written up in the handover notes; the search box carries the caveat in its hint.
 *
 * REGISTRY READS ARE NOT A PATIENT LOOKUP TOOL. `PatientPolicy::viewAny` admits
 * administrator, clinician and front desk, and there is no cross-clinic search anywhere in
 * this product and will not be — the isolation boundary between clinics is absolute.
 */
export async function listPatients(cursor?: string | undefined): Promise<PatientPage> {
  const api = await readingApi()
  const response = await api.get<{
    data: Patient[]
    meta: { next_cursor: string | null }
  }>('/v1/patients', { query: { cursor } })

  return { patients: response.data, nextCursor: response.meta.next_cursor }
}

/** One patient of this clinic, by id. A stranger's id is a 404 and stays one. */
export async function getPatient(id: string): Promise<Patient> {
  const api = await readingApi()
  const response = await api.get<{ data: Patient }>(`/v1/patients/${encodeURIComponent(id)}`)

  return response.data
}

/** Find one in a list already fetched. Saves a second round trip on every screen that has both. */
export function byId<T extends { id: string }>(items: readonly T[], id: string | undefined): T | null {
  return items.find((item) => item.id === id) ?? null
}
