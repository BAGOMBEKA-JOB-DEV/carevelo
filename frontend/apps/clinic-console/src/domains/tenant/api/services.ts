import { readClient, writeClient } from './http'
import type { NewService, Service, ServiceChanges } from '../model/types'

/**
 * The clinic's own catalogue of bookable services.
 *
 * PRICES ARE PER TENANT AND CAREVELO HAS NO OPINION. There is no platform price list, no
 * recommended fee and no margin; a clinic in Gulu charging 20,000 for a follow-up and one
 * in Kampala charging 60,000 are both correctly configured. Nothing in this file supplies
 * a default price, and `model/price.ts` says why at length.
 *
 * RETURNED WHOLE, NOT PAGINATED, and that is the API's decision rather than an oversight
 * this file should paper over: a private Ugandan clinic offers tens of services and the
 * administrator editing them needs all of them at once. A cursor here would be a second
 * round trip for nothing.
 *
 * WHAT THE ADMINISTRATOR SEES THAT A PATIENT DOES NOT. `ServiceController::index` filters
 * to `is_active` for anyone who is not staff. This call is made with an administrator's
 * session, so it returns the deactivated ones too — which is the whole point of the
 * screen: a service that has left the catalogue is still a row a clinic may want back.
 */

export async function listServices(): Promise<Service[]> {
  const client = await readClient()
  const response = await client.get<{ data: Service[] }>('/v1/services')

  return response.data
}

export async function createService(service: NewService): Promise<Service> {
  const client = await writeClient()
  const response = await client.post<{ data: Service }>('/v1/services', service)

  return response.data
}

/**
 * Change a service.
 *
 * PATCH, and the body carries only what changed. `ServiceRequest::changesPrice()` asks
 * whether `price_minor` is PRESENT rather than whether it is set, so an update that omits
 * it leaves the price alone — and one that sends it as an absent field would rewrite the
 * price from nothing, which reads as zero.
 */
export async function updateService(id: string, changes: ServiceChanges): Promise<Service> {
  const client = await writeClient()
  const response = await client.patch<{ data: Service }>(
    `/v1/services/${encodeURIComponent(id)}`,
    changes,
  )

  return response.data
}

/**
 * Take a service out of the catalogue.
 *
 * DELETE IS A DEACTIVATION AND THE ROW SURVIVES. Appointments, and through them
 * consultations and prescriptions, carry a `service_id`; removing the row would orphan
 * every one of them and a clinic looking at last year's bookings would see a reference
 * resolving to nothing. The verb stays DELETE because that is what the administrator
 * means and because the observable effect — it leaves the catalogue — is the same.
 *
 * The screen must not call this "delete". It says "Stop offering", because the difference
 * matters to a clinic asked later to produce a record.
 */
export async function deactivateService(id: string): Promise<Service> {
  const client = await writeClient()
  const response = await client.delete<{ data: Service }>(
    `/v1/services/${encodeURIComponent(id)}`,
  )

  return response.data
}

/**
 * Put a deactivated service back.
 *
 * There is no dedicated endpoint and there does not need to be: reactivation is an
 * ordinary field change, and DELETE having become "set is_active false" is precisely why
 * the inverse is a PATCH rather than an undelete.
 */
export async function reactivateService(id: string): Promise<Service> {
  return updateService(id, { is_active: true })
}
