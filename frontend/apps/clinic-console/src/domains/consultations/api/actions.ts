'use server'

import { findConsultationForAppointment } from './consultations'
import { roomSignature } from './consultations'
import { listNotes, saveDraft, type SaveResult } from './notes'
import { isNoteSection } from '../model/drafts'

/**
 * The two things the BROWSER is allowed to ask this domain, and neither of them is for data.
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

  return roomSignature(consultation, notes?.length ?? 0)
}
