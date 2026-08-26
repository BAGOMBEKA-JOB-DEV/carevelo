import { ApiError, type operations } from '@carevelo/api-client'
import { classifyFailure, type ConsultationMessage, type SendResult } from '../model/chat'
import { readingApi, writingApi } from './gateway'

/**
 * The consultation transcript, read and written as the signed-in clinician.
 *
 * ====================================================================================
 * THE SHAPES ARE THE CONTRACT'S. NONE OF THEM IS DESCRIBED TWICE.
 * ====================================================================================
 *
 * `GET /v1/consultations/{consultation}/messages` and its POST sibling reached
 * `docs/40-api/openapi.yaml` through `php artisan api:contract`, which derives the document
 * from the live routes rather than from anybody's memory of them, and
 * `packages/api-client` was regenerated from that YAML. So the two types below are indexed
 * out of `operations`, and `pnpm api-client:check` fails the build if the committed client
 * stops matching the document. A hand-written response shape is a shape that goes on
 * type-checking after the API has stopped returning it.
 *
 * ====================================================================================
 * WHO MAY READ THIS, WHICH IS NARROWER THAN WHO MAY READ THE NOTE
 * ====================================================================================
 *
 * Worth knowing before anybody adds a call from another screen. `ClinicalNoteController`
 * authorises `view` — any clinician or clinic_admin of the tenant. This controller
 * authorises `participate`, which admits exactly two people: the patient the encounter
 * belongs to, and the clinician conducting THIS encounter. A covering colleague gets a 403,
 * and so does the clinic administrator.
 *
 * That is deliberate on the backend and it has a stated cost — a covering clinician cannot
 * read the transcript through the API. Do not widen it from this side by adding a screen
 * that expects to; the way to grant care-team access is to change the ability, audited,
 * rather than to discover the 403 in a consulting room.
 *
 * READS ARE AUDITED. `index` writes `consultation_message.viewed` with a COUNT and never a
 * line. The room's fifteen-second poll includes this call, which is what makes chat live at
 * all — and it means a live consultation writes roughly four of those events a minute per
 * participant. `RoomLive` bounds it: the timer stops while the tab is hidden and never runs
 * for a consultation that has ended.
 *
 * @see backend/app/Http/Controllers/Api/V1/ConsultationMessageController.php
 * @see backend/app/Policies/ConsultationPolicy.php — `participate`
 */

type TranscriptResponse =
  operations['v1.consultations.messages.index']['responses'][200]['content']['application/json']

type SentResponse =
  operations['v1.consultations.messages.store']['responses'][201]['content']['application/json']

/**
 * Every message on this consultation, oldest first.
 *
 * OPEN FOR EVER, INCLUDING AFTER THE ENCOUNTER ENDS, unlike `send()` below. The conversation
 * is part of the medical record, and a record you cannot read back is not one — which is
 * also why this is the screen a clinician reaches with no room cookie at all.
 *
 * NULL IS "NOT YOURS TO READ", NOT "EMPTY". A 404 and a 403 fold together, as they do in
 * `listNotes`: the API answers 404 for another clinic's consultation precisely so the
 * existence of the record is not confirmed, and folding 403 in keeps this side from
 * redrawing a distinction the API refuses to draw. Every other failure is rethrown — a 500
 * or a dropped connection is not "the patient has written nothing", and rendering it as an
 * empty conversation would have a clinician answering somebody who, as far as the screen is
 * concerned, said nothing at all.
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
 * Say something to the patient.
 *
 * RETURNS A VALUE FOR EVERY OUTCOME AND THROWS NOTHING — the rule `api/notes.ts` sets for
 * this domain: "an error boundary in the middle of a consultation is a clinician losing
 * their screen with a patient watching." Every failure comes back as one of six words, which
 * the composer renders as a sentence beside the box with the text still in it.
 *
 * `status: null` FOR A REQUEST THAT NEVER COMPLETED — a consulting room with one bar of
 * signal, which is the ordinary failure here rather than the exotic one. It classifies as
 * `offline` and earns its own sentence, because the recovery differs: the message may have
 * landed, so the advice is to look before retyping rather than to send it again and give the
 * patient the same instruction twice.
 *
 * ONE FIELD ON THE WIRE. There is no `author_id` and no `author_role` to send: the server
 * derives which side is speaking from the authorisation decision it has just taken, and
 * `RejectsUnknownFields` turns an attempt to assert either into a 422 rather than discarding
 * it quietly. A client able to assert it could put words into the patient's mouth inside a
 * clinical record.
 */
export async function sendMessage(consultationId: string, body: string): Promise<SendResult> {
  try {
    const api = await writingApi()

    await api.post<SentResponse>(
      `/v1/consultations/${encodeURIComponent(consultationId)}/messages`,
      { body },
    )

    return { ok: true }
  } catch (error) {
    return { ok: false, reason: classifyFailure(error instanceof ApiError ? error.status : null) }
  }
}
