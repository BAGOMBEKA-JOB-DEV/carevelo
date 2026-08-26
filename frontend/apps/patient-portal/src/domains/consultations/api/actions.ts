'use server'

import { redirect } from 'next/navigation'
import { findConsultationForAppointment, roomSignature } from './consultations'
import { listMessages, sendMessage } from './messages'
import { consultationHref } from './paths'
import { enterRoom, forgetRoom } from './room'
import type { SendResult } from '../model/chat'

/**
 * The four things a patient can actually DO in this domain.
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
  const consultation = await findConsultationForAppointment(appointmentId)

  if (consultation === null) {
    return roomSignature(null)
  }

  /*
   * THE TRANSCRIPT IS COUNTED HERE, AND IT IS WHAT MAKES CHAT LIVE.
   *
   * The count goes into the signature; a message arriving changes it; `RoomLive` sees the
   * difference and calls `router.refresh()`, and the SERVER renders the new line. The
   * browser is told only that something moved — never what was said. That is the same rule
   * `ConsultationMessageSent` obeys on its own broadcast, applied to a poll.
   *
   * IT COSTS AN AUDIT EVENT EVERY FIFTEEN SECONDS, and that is worth stating rather than
   * discovering. `index` writes `consultation_message.viewed` with a count on every read, so
   * a live consultation writes roughly four an minute per participant. Reads of a clinical
   * record are audited on purpose — "who read my consultation" is only answerable by having
   * recorded every read — and the alternative is chat that is fresh only when somebody
   * reloads, which is not chat. `RoomLive` bounds it: the timer stops while the tab is
   * hidden and never starts for an ended consultation.
   *
   * A FAILED READ COUNTS AS ZERO rather than throwing. This runs on a timer in a browser;
   * an exception here would surface as an unhandled rejection in a console and change
   * nothing on screen. A wrong count costs one missed tick of freshness — the next one
   * corrects it — and never correctness, because the server render is what draws.
   */
  return roomSignature(consultation, (await listMessages(consultation.id))?.length ?? 0)
}

/**
 * Say something to the clinician.
 *
 * A MODULE-LEVEL `'use server'` EXPORT because `ChatComposer` is a client component, and a
 * client component can only reach across the boundary through one of these. It takes its
 * two arguments from the browser and treats both as arguments to an AUTHORISED CALL rather
 * than as assertions: `ConsultationPolicy::participate` admits exactly two people — the
 * patient the encounter belongs to and the clinician conducting it — and row-level security
 * decides which consultation exists at all. A forged identifier resolves to a 404.
 *
 * THERE IS NO `author_role` PARAMETER AND THERE MUST NOT BE. The server derives which side
 * is speaking from the authorisation decision it has just taken; the form request has no
 * such field and `RejectsUnknownFields` turns an attempt into a 422. A client able to assert
 * it could put words into the other participant's mouth inside a clinical record.
 *
 * RETURNS A VALUE FOR EVERY OUTCOME AND THROWS NOTHING — see `api/messages.ts`. A thrown
 * Server Action inside a client component becomes an error boundary, and an error boundary
 * here is a patient losing the screen they are being treated on, along with what they had
 * typed into it.
 */
export async function sendConsultationMessage(
  consultationId: string,
  body: string,
): Promise<SendResult> {
  return sendMessage(consultationId, body)
}
