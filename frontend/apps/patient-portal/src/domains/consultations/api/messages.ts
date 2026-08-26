import { ApiError, type operations } from '@carevelo/api-client'
import { classifyFailure, type ConsultationMessage, type SendResult } from '../model/chat'
import { readingApi, writingApi } from './gateway'

/**
 * The consultation transcript, read and written as the signed-in patient.
 *
 * ====================================================================================
 * THE SHAPES ARE THE CONTRACT'S. NONE OF THEM IS DESCRIBED TWICE.
 * ====================================================================================
 *
 * `GET /v1/consultations/{consultation}/messages` and its POST sibling were added to
 * `docs/40-api/openapi.yaml` by `php artisan api:contract` reading the live routes, and
 * `packages/api-client` was regenerated from that YAML. So the two types below are indexed
 * out of `operations` rather than hand-written, and `pnpm api-client:check` fails the build
 * if the committed client ever stops matching the document. A hand-written response shape
 * is a shape that type-checks after the API has stopped returning it.
 *
 * ====================================================================================
 * READS ARE AUDITED, WHICH IS WHY THE POLL COSTS SOMETHING
 * ====================================================================================
 *
 * `index` writes `consultation_message.viewed` with a COUNT and never a line — "who read my
 * consultation?" can only be answered by having recorded every read. The room's fifteen-
 * second freshness poll now includes this call, so a live consultation writes roughly four
 * of those events a minute per participant. That is real and it is deliberate: chat that is
 * only fresh when somebody reloads is not chat, and the console already pays the same price
 * for `clinical_note.viewed` on the same timer.
 *
 * Two things keep it bounded rather than open-ended. `RoomLive` stops the timer entirely
 * while the tab is hidden and never starts it for a consultation that has ended — so the
 * events are written during an encounter somebody is actually looking at, and stop when
 * they stop looking.
 *
 * @see backend/app/Http/Controllers/Api/V1/ConsultationMessageController.php
 */

type TranscriptResponse =
  operations['v1.consultations.messages.index']['responses'][200]['content']['application/json']

type SentResponse =
  operations['v1.consultations.messages.store']['responses'][201]['content']['application/json']

/**
 * Every message on this consultation, oldest first.
 *
 * OPEN FOR EVER, INCLUDING AFTER THE ENCOUNTER ENDS, and that asymmetry with `send()` below
 * is the controller's own: the conversation is part of the medical record, and a record you
 * cannot read back is not one.
 *
 * NULL IS "NOT YOURS TO READ", NOT "EMPTY". A 404 and a 403 fold together — the API answers
 * 404 for another patient's consultation precisely so that the existence of the record is
 * not confirmed, and folding 403 in here keeps this side from redrawing a distinction the
 * API refuses to draw. An empty transcript is `[]` and renders as an empty transcript; null
 * renders as the panel saying it cannot show the conversation.
 *
 * ANY OTHER FAILURE IS RETHROWN. A 500 or a dropped connection is not "there are no
 * messages", and returning `[]` for it would draw an empty conversation over a real one —
 * which, on a screen where a clinician may have written "go to the hospital now", is the
 * worst available answer.
 */
export async function listMessages(consultationId: string): Promise<ConsultationMessage[] | null> {
  try {
    const api = await readingApi()
    const response = await api.get<TranscriptResponse>(
      `/v1/consultations/${encodeURIComponent(consultationId)}/messages`,
    )

    return response.data
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null
    }

    throw error
  }
}

/**
 * Say something.
 *
 * RETURNS A VALUE FOR EVERY OUTCOME AND THROWS NOTHING. A thrown Server Action in a client
 * component becomes an error boundary, and an error boundary here is a patient losing the
 * screen they are being treated on, with whatever they had typed. Every failure comes back
 * as one of six words, which the composer renders as a sentence beside the box with the
 * text still in it.
 *
 * `status: null` FOR A REQUEST THAT NEVER COMPLETED, which on this product's target
 * connection is the ordinary failure rather than the exotic one. It classifies as `offline`
 * and gets its own sentence, because the recovery genuinely differs: the message may have
 * landed, so the advice is to look rather than to retype.
 *
 * NOTHING FROM THE API'S OWN PROBLEM DOCUMENT IS FORWARDED. Same closed-set discipline the
 * entry flow already applies to `?entry=`: a screen that prints a string handed to it is a
 * screen that can be made to say anything, and this one sits beside a telephone number a
 * patient is being asked to trust.
 */
export async function sendMessage(consultationId: string, body: string): Promise<SendResult> {
  try {
    const api = await writingApi()

    await api.post<SentResponse>(
      `/v1/consultations/${encodeURIComponent(consultationId)}/messages`,
      // ONE FIELD. There is no `author_id` and no `author_role` to send: the server derives
      // both from the session and from the authorisation decision, and `RejectsUnknownFields`
      // turns an attempt to assert either into a 422 rather than discarding it quietly.
      { body },
    )

    return { ok: true }
  } catch (error) {
    return { ok: false, reason: classifyFailure(error instanceof ApiError ? error.status : null) }
  }
}
