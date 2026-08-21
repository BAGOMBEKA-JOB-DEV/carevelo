'use server'

import { redirect } from 'next/navigation'
import { findConsultationForAppointment, roomSignature } from './consultations'
import { consultationHref } from './paths'
import { enterRoom, forgetRoom } from './room'

/**
 * The three things a patient can actually DO in this domain.
 *
 * WHY THEY ARE SERVER ACTIONS AND NOT CLIENT HANDLERS. `<form action={serverAction}>`
 * posts natively: it works before the bundle arrives, with JavaScript switched off, and on
 * the mid-range Android on variable mobile data that the performance budget is written
 * against. A patient who cannot get into their consultation because a script had not
 * downloaded is the failure this shape makes impossible.
 *
 * WHY ENTERING IS A POST AND NOT A LINK. The join token is single-use. A GET would be
 * spent by a refresh, a back button or the router prefetching the link, and the patient
 * would be locked out by their own browser. See ./room.ts.
 *
 * ON THE HIDDEN FIELD. `appointment_id` arrives from the form, which is to say from the
 * person on the other side, and that is fine: it is an argument to an authorised call, not
 * an assertion of anything. The API decides under AppointmentPolicy::join and row-level
 * security, and answers 404 for another clinic's appointment. Nothing here is trusted with
 * that decision.
 */

/**
 * Go into the consultation: issue a pass, spend it, and land in the room.
 *
 * The failure branch is a redirect back to the same link rather than a thrown error,
 * because the same link is the way in and the page it renders already knows how to say
 * what went wrong.
 */
export async function enterConsultation(formData: FormData): Promise<void> {
  const appointmentId = String(formData.get('appointment_id') ?? '').trim()

  if (appointmentId === '') {
    redirect('/account')
  }

  const result = await enterRoom(appointmentId)

  if (result.ok) {
    redirect(consultationHref(appointmentId))
  }

  redirect(`${consultationHref(appointmentId)}?entry=${classify(result.status)}`)
}

/**
 * Which of three sentences the join screen should show.
 *
 * A CLOSED SET OF CODES, AND THE API'S OWN SENTENCE IS DELIBERATELY NOT FORWARDED. Putting
 * `&reason=<the message>` in the URL would make the screen render an arbitrary string
 * supplied by whoever wrote the link — and a link is exactly how a patient arrives at this
 * page. "Your account is locked, call 07…" in the clinic's own colours, on the screen where
 * the clinic's telephone number is the working fallback, is a convincing thing to be sent.
 * Three codes cost three sentences in the catalogue and close that off entirely.
 *
 * Nothing is lost by it here. The join endpoints raise AuthorizationException and a
 * validation error on the token field, and bootstrap/app.php flattens every
 * AuthorizationException to the same document — 403, "You do not have permission to do
 * that" — so the controller's real sentences ("This appointment cannot be joined", "This
 * appointment has finished") never reach the wire in the first place. There is no message
 * worth forwarding, only a status worth reading.
 */
function classify(status: number): 'refused' | 'session' | 'failed' {
  if (status === 403 || status === 404) {
    return 'refused'
  }

  // 419 is Laravel's expired CSRF token, which presents to the patient as exactly what it
  // is: the session went stale while the page sat open.
  if (status === 401 || status === 419) {
    return 'session'
  }

  return 'failed'
}

/**
 * Leave the room. Not: end the consultation.
 *
 * Only a clinician ends a consultation, and only through POST /v1/consultations/{id}/end.
 * This forgets the portal's memory of an entry and nothing else — the encounter, its
 * timestamps and anything written during it are untouched, which is why the button says so.
 */
export async function leaveConsultation(formData: FormData): Promise<void> {
  const appointmentId = String(formData.get('appointment_id') ?? '').trim()

  await forgetRoom()

  redirect(appointmentId === '' ? '/account' : consultationHref(appointmentId))
}

/**
 * Has anything about this consultation changed?
 *
 * Returns a short signature and NOT the consultation. That is the same rule
 * @carevelo/realtime enforces on a broadcast frame — a hint to re-fetch, never the thing
 * itself — applied to a poll, and it buys the same three things: the server component
 * stays the only thing that renders, the re-render runs the full authorisation again, and
 * nothing clinical is ever handed to a browser that was not going to render it anyway.
 *
 * `appointmentId` comes from the client. It is an argument to an authorised read: the API
 * narrows the consultation list to this patient's own rows, so the worst a forged argument
 * achieves is a signature for a consultation that is already theirs.
 */
export async function checkRoom(appointmentId: string): Promise<string> {
  return roomSignature(await findConsultationForAppointment(appointmentId))
}
