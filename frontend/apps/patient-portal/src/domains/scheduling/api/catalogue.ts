import { readClient } from './http'
import type { Clinician, Service } from '../model/types'

/**
 * What the clinic offers, and who works there.
 *
 * BOTH ARE RETURNED WHOLE, NOT PAGINATED, and that is the API's decision rather than an
 * oversight this file should paper over: a private Ugandan clinic offers tens of services
 * and engages a handful of clinicians, and a patient choosing needs to see all of them.
 * A cursor here would be a second round trip for nothing on a connection that cannot
 * spare the first one.
 *
 * WHAT THE PATIENT'S COPY OF THE CATALOGUE LEAVES OUT. `ServiceController` filters to
 * `is_active` for anyone who is not staff, because a deactivated service stays in the
 * table — historical appointments point at it — and publishing one would let a patient
 * book care that has been withdrawn and then travel to the clinic for it. This file does
 * not re-filter: doing so would encode a rule the backend already owns, and the two
 * copies would be free to disagree.
 */

/** The clinic's bookable services, in the clinic's own order. */
export async function listServices(): Promise<Service[]> {
  const client = await readClient()
  const response = await client.get<{ data: Service[] }>('/v1/services')

  return response.data
}

/**
 * The clinic's clinicians, alphabetically.
 *
 * Name, specialty, photo. The registration number is absent from the resource by design
 * and nothing here may add one — see the note on `Clinician` in model/types.ts.
 */
export async function listClinicians(): Promise<Clinician[]> {
  const client = await readClient()
  const response = await client.get<{ data: Clinician[] }>('/v1/clinicians')

  return response.data
}

/**
 * The clinicians and services this domain needs, by id.
 *
 * An appointment carries `service_id` and `clinician_id` and NOT their names. That is
 * deliberate on the backend's part and worth restating here, because the natural instinct
 * on reading `AppointmentResource` is that somebody forgot: a service name — "Antenatal
 * Review" — is health information about the person who booked it, and putting it on a
 * resource means putting it wherever that resource travels. The client already holds the
 * clinic's catalogue, so it resolves the name itself, in-app, behind authentication.
 */
export function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}
