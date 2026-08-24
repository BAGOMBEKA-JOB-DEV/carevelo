import { readClient } from './http'
import type { AvailabilityMeta, Slot } from '../model/types'

/**
 * When the clinic can actually see this patient.
 *
 * THE ANSWER IS ADVISORY AND THE CONTROLLER SAYS SO IN AS MANY WORDS. Slots are the
 * clinic's working hours minus the clinician's busy periods, computed in the CLINIC's
 * timezone and sliced by the service's own duration; booking then re-checks the slot
 * inside a transaction, because two patients can read the same free slot a millisecond
 * apart. This endpoint narrows the race, it does not decide it.
 *
 * Everything downstream of this function is built on that. A slot taken between display
 * and submit is a NORMAL OUTCOME with its own copy — see `booking.slotTakenTitle` — and
 * never an error page, because nothing has gone wrong: somebody else was quicker.
 *
 * WHY `from` AND `to` ARE PLAIN CALENDAR DATES. `AvailabilityController::window()` parses
 * them with the tenant's timezone, so `2026-08-21` means the clinic's day, opening to
 * closing. Sending an instant instead would drag the portal's idea of a day boundary into
 * a decision that belongs to the clinic.
 *
 * @see backend/app/Http/Controllers/Api/V1/AvailabilityController.php
 */

export type AvailabilityQuery = {
  serviceId: string
  /** Absent means every clinician, which is what a patient with no preference is asking. */
  clinicianId?: string | undefined
  /** `YYYY-MM-DD` in the clinic's timezone. */
  from?: string | undefined
  /** `YYYY-MM-DD` in the clinic's timezone, inclusive to the end of that day. */
  to?: string | undefined
}

export type Availability = {
  slots: Slot[]
  /** The window the API actually covered, which may be narrower than the one asked for. */
  meta: AvailabilityMeta
}

export async function listAvailability(query: AvailabilityQuery): Promise<Availability> {
  const client = await readClient()

  const response = await client.get<{ data: Slot[]; meta: AvailabilityMeta }>('/v1/availability', {
    // ApiClient drops undefined rather than sending the string "undefined", so an absent
    // clinician really is "anyone" rather than a clinician whose id is a typo.
    query: {
      service_id: query.serviceId,
      clinician_id: query.clinicianId,
      from: query.from,
      to: query.to,
    },
  })

  return { slots: response.data, meta: response.meta }
}
