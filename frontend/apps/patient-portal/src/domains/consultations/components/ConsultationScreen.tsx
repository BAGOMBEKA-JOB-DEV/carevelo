import { notFound } from 'next/navigation'
import type { Tenant } from '@/lib/tenant'
import { loadConsultationEntry } from '../api/consultations'
import { ConsultationRoom } from './ConsultationRoom'
import { JoinPanel, type EntryFailure } from './JoinPanel'

/**
 * The whole journey behind one link: the lobby, the room, and every honest reason for
 * neither.
 *
 * ONE COMPONENT SO THE ROUTE HOLDS NO LOGIC. `src/app` composes and renders — deciding
 * whether a booking may be entered is business logic, and business logic in the routing
 * tree is logic nothing looks for and no other surface can reuse. So the route resolves
 * the clinic, checks there is a session, and renders this; everything else is here.
 *
 * ONE LINK, because the product requires it. The confirmation SMS carries `{join_link}`,
 * the front desk reads it down the telephone, and a patient whose connection dropped opens
 * the same one again — that last is the "resume link" the dropped-call exception path asks
 * for, and it is the same URL precisely so that nobody has to be sent a second one. The
 * screen a given visit renders depends on the booking and on whether this browser is
 * already inside; the address does not change.
 *
 * A 404 FOR AN APPOINTMENT THAT IS NOT THIS PATIENT'S, whether it never existed, belongs to
 * someone else at this clinic, or belongs to another clinic entirely. The API answers all
 * three the same way and this must not undo that: a 403 would confirm the record exists,
 * and that a given patient is a patient of some other clinic is exactly the fact the
 * isolation boundary exists to keep.
 *
 * @see docs/30-architecture/multi-tenancy.md — cross-tenant reads are 404, never 403
 */
export async function ConsultationScreen({
  tenant,
  appointmentId,
  clinicianName,
  emergencyGuidance,
  entry,
}: {
  tenant: Tenant
  appointmentId: string
  /**
   * The clinician's name, when the composing route has it.
   *
   * Optional because this domain will not spend a round trip to fetch it: AppointmentResource
   * carries `clinician_id` and no name, and the scheduling domain is already reading the
   * clinician list for the booking journey. Absent, the screens simply do not name them —
   * which is better than a second list request on a handset for one string.
   */
  clinicianName?: string | undefined
  /** The clinic's own emergency wording, when the tenant resource grows a field for it. */
  emergencyGuidance?: string | undefined
  /** `?entry=` from the URL, set by the enter action when it failed. Forwarded raw. */
  entry?: string | undefined
}) {
  const state = await loadConsultationEntry(appointmentId)

  if (state === null) {
    notFound()
  }

  if (state.kind === 'room') {
    return (
      <ConsultationRoom
        tenant={tenant}
        appointment={state.appointment}
        bookedMode={state.bookedMode}
        credentials={state.credentials}
        consultation={state.consultation}
        clinicianName={clinicianName}
        emergencyGuidance={emergencyGuidance}
      />
    )
  }

  return (
    <JoinPanel
      tenant={tenant}
      state={state}
      clinicianName={clinicianName}
      emergencyGuidance={emergencyGuidance}
      entryError={entryFailure(entry)}
    />
  )
}

/**
 * The failure the last press left in the URL, normalised.
 *
 * Normalised HERE rather than in the route, so that a route file never has to know what
 * `entry=refused` means. ANYTHING UNRECOGNISED IS NO ERROR AT ALL, and that is the point of
 * a closed set: a search parameter is under the control of whoever wrote the link, and a
 * page that renders arbitrary text from a URL as an error is a page that can be made to say
 * anything to a patient who was sent one. The three codes below are the only strings this
 * screen will speak, and each maps to a sentence in the catalogue rather than to the URL.
 */
function entryFailure(entry: string | undefined): EntryFailure | undefined {
  return entry === 'refused' || entry === 'session' || entry === 'failed' ? entry : undefined
}
