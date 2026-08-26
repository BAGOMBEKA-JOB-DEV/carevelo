'use server'

import { findConsultationForAppointment } from './consultations'
import { roomSignature } from './consultations'
import { listMessages, sendMessage } from './messages'
import { listNotes, saveDraft, type SaveResult } from './notes'
import type { SendResult } from '../model/chat'
import { isNoteSection } from '../model/drafts'

/**
 * The three things the BROWSER is allowed to ask this domain, and none of them is for data.
 *
 * Everything else in this domain is reached by a native form post to an inline server action
 * closed over the values the server rendered with. These two are here because a client
 * component has to import them: a module-level `'use server'` export is the only thing
 * `'use client'` code can call across the boundary.
 *
 * WHAT THAT COSTS AND WHY IT IS ACCEPTABLE. Both take arguments from the browser, so both
 * treat them as arguments to an AUTHORISED CALL rather than as assertions. The API decides
 * everything: `ConsultationPolicy::conduct` decides who may write a note, row-level security
 * decides which consultation exists at all, and a forged identifier resolves to a 404. Nothing
 * here is trusted with a decision.
 */

/**
 * SAVE A SECTION OF THE NOTE.
 *
 * ====================================================================================
 * THIS IS THE CALL THE WHOLE ROOM IS BUILT AROUND
 * ====================================================================================
 *
 * "Notes must never be lost" is a hard requirement, and the requirement is met by local
 * storage rather than by this function — the browser has already written the text down before
 * this is called, and will still have it if this never returns. What this adds is durability
 * beyond one browser, and the one thing local storage cannot do: notice that somebody ELSE
 * wrote in the same section, and refuse to paper over it.
 *
 * IT RETURNS A DISCRIMINATED RESULT AND THROWS NOTHING. A thrown server action in a client
 * component becomes an error boundary, and an error boundary in the middle of a consultation
 * is a clinician losing their screen with a patient watching. Every failure is a value.
 *
 * `force` IS NOT AN OVERRIDE OF A SAFETY CHECK. Notes are append-only; "keep mine as well"
 * cannot destroy the other text and never could. The flag exists so the check cannot be
 * skipped by accident — a caller has to have been shown the conflict to be in a position to
 * set it.
 *
 * @see model/drafts.ts — the local storage contract this is the network half of
 * @see api/notes.ts — how a conflict is detected
 */
export async function saveNoteSection(input: {
  consultationId: string
  section: string
  body: string
  baseNoteId: string | null
  force?: boolean
}): Promise<SaveResult> {
  if (!isNoteSection(input.section)) {
    // The section is one of four and arrives from a component that only ever sends one of
    // four. A narrowing step anyway, because "arrives from our own code" is a description of
    // today's code and not a property of the boundary.
    return { kind: 'problem', message: 'That is not a section of the note.' }
  }

  return saveDraft({
    consultationId: input.consultationId,
    section: input.section,
    body: input.body,
    baseNoteId: input.baseNoteId,
    force: input.force,
  })
}

/**
 * Has anything about this consultation changed?
 *
 * Returns a short signature and NOT the consultation. That is @carevelo/realtime's rule — a
 * frame is a hint to re-fetch, never the thing itself — applied to a poll, and it buys the
 * same three things: the server component stays the only thing that renders, the re-render
 * runs the full authorisation again, and nothing clinical is ever handed to a browser that was
 * not going to render it anyway.
 *
 * THE ROOM NEEDS THIS BECAUSE IT IS SERVER-RENDERED AND THEREFORE CORRECT ONCE. The patient
 * joins. A colleague adds an addendum. The clinician's own second tab ends the encounter.
 * None of that reaches a page drawn four minutes ago, and the failure is silent — which is the
 * frozen frame the whole degradation design exists to prevent, arriving by a different road.
 */
export async function roomDigest(appointmentId: string, patientId: string): Promise<string> {
  const consultation = await findConsultationForAppointment(appointmentId, patientId)

  if (consultation === null) {
    return roomSignature(null, 0)
  }

  const notes = await listNotes(consultation.id)
  const messages = await listMessages(consultation.id)

  /*
   * THE MESSAGE COUNT IS IN THE DIGEST, AND IT IS WHAT MAKES CHAT LIVE.
   *
   * `ConsultationMessageSent` broadcasts to `private-tenant.{t}.consultation.{c}` carrying
   * identifiers and no body — but no app in this workspace declares `@carevelo/realtime` as a
   * dependency, so nothing consumes it, and polling is the FLOOR here rather than the
   * fallback. `RoomLive` already asks for this string every fifteen seconds; folding the count
   * in means a patient's message changes it, the poll notices, and the SERVER re-renders the
   * transcript.
   *
   * A COUNT AND NEVER A BODY, which is the same rule the broadcast obeys: the browser learns
   * only THAT something moved. Nothing clinical is in this string and nothing here is rendered.
   *
   * IT COSTS AN AUDIT EVENT EVERY FIFTEEN SECONDS. `consultation_message.viewed` is written on
   * every read, so a live consultation writes roughly four a minute per participant — on top
   * of the `clinical_note.viewed` this function already wrote. Reads of a clinical record are
   * audited on purpose, and the alternative is a clinician who does not see a patient's
   * message until they reload. `RoomLive` bounds it: the timer stops while the tab is hidden
   * and never runs for a consultation that has ended.
   *
   * AN UNREADABLE TRANSCRIPT COUNTS AS ZERO rather than throwing. This runs on a timer in a
   * browser, and a wrong count costs one missed tick of freshness — the next one corrects it —
   * and never correctness, because the server render is what draws.
   */
  return roomSignature(consultation, notes?.length ?? 0, messages?.length ?? 0)
}

/**
 * SAY SOMETHING TO THE PATIENT.
 *
 * Here for the same reason `saveNoteSection` is: `ChatComposer` is a client component, and a
 * module-level `'use server'` export is the only thing `'use client'` code can call across the
 * boundary. It takes both arguments from the browser and treats both as arguments to an
 * AUTHORISED CALL rather than as assertions — `ConsultationPolicy::participate` admits exactly
 * two people, row-level security decides which consultation exists at all, and a forged
 * identifier resolves to a 404.
 *
 * THERE IS NO `author_role` PARAMETER AND THERE MUST NOT BE. The server derives which side is
 * speaking from the authorisation decision it has just taken; the form request has no such
 * field and `RejectsUnknownFields` turns an attempt into a 422. A client able to assert it
 * could put words into the patient's mouth inside a clinical record.
 *
 * IT RETURNS A DISCRIMINATED RESULT AND THROWS NOTHING, for the reason given above
 * `saveNoteSection`: a thrown server action in a client component becomes an error boundary,
 * and an error boundary in the middle of a consultation is a clinician losing their screen
 * with a patient watching.
 */
export async function sendConsultationMessage(
  consultationId: string,
  body: string,
): Promise<SendResult> {
  return sendMessage(consultationId, body)
}
