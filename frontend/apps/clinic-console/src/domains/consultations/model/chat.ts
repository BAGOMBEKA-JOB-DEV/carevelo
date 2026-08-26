import type { components } from '@carevelo/api-client'

/**
 * Consultation chat from the clinician's side, reduced to the judgements a machine can get
 * wrong — and nothing that touches a browser, a cookie or the network, so all of them are
 * executable by a test.
 *
 * ====================================================================================
 * THE CONSOLE HAD NO CHAT SURFACE AT ALL, NOT EVEN A PLACEHOLDER
 * ====================================================================================
 *
 * The patient portal has carried a panel saying "typing here would reach nobody" since it
 * was built. This console carried nothing: a clinician had no way to read what a patient
 * had written and no way to answer. That asymmetry was worse than the portal's honest
 * placeholder, because the portal at least told the patient the truth — while `chat` was a
 * `ConsultationMode` the clinician could STEP THE CONSULTATION DOWN INTO, on a screen with
 * no chat on it. `ModeControl` offers that step today.
 *
 * ====================================================================================
 * A MESSAGE IS A CLINICAL INSTRUCTION. THAT SETS EVERY RULE BELOW.
 * ====================================================================================
 *
 * It is not the note. The note is a document composed for the record and corrected by
 * addendum; a message is a turn in a conversation, corrected by saying something else, and
 * it is read and acted on by a patient within the minute. Three consequences, each a
 * function here rather than a paragraph somewhere:
 *
 *   1. NEVER TRUNCATED. `StoreConsultationMessageRequest` caps a message at 4,000 characters
 *      — a fifth of the note's 20,000, because "someone pasting four thousand characters into
 *      a chat window is writing a note, and they should write it as a note where the addendum
 *      mechanism exists". The answer to a longer one is to REFUSE IT AND SAY SO, never to
 *      send the first 4,000. `checkLength()` is that decision.
 *   2. NEVER MISATTRIBUTED. `sideOf()` decides from the server's own `author_role` and never
 *      from ordering or styling.
 *   3. NEVER SILENTLY DROPPED. The composer is not rendered at all when the encounter cannot
 *      accept one — `canSend()` — and every failed send resolves to a sentence.
 *
 * @see backend/app/Http/Controllers/Api/V1/ConsultationMessageController.php
 * @see backend/app/Http/Requests/V1/Consultations/StoreConsultationMessageRequest.php
 */

/** One line of the transcript, taken from the contract rather than described a second time. */
export type ConsultationMessage = components['schemas']['ConsultationMessageResource']

/**
 * The longest message the API will accept, mirrored so the composer can refuse before the
 * round trip rather than after it.
 *
 * MIRRORED, WHICH MEANS IT CAN DRIFT, AND THE DRIFT IS SAFE IN ONE DIRECTION ONLY. If the
 * backend's limit rises this is merely conservative. If it falls, a message reaches a 422 —
 * which `classifyFailure` turns into the same sentence the local check would have shown.
 * Both ends fail towards telling the clinician, never towards sending a fragment.
 */
export const MAX_MESSAGE_LENGTH = 4_000

/** What is wrong with what has been typed, if anything. */
export type LengthVerdict = 'empty' | 'too-long' | 'ok'

/**
 * May this be sent as it stands?
 *
 * TRIMMED FOR THE EMPTINESS TEST AND MEASURED UNTRIMMED FOR THE LENGTH TEST, deliberately.
 * Whitespace is not a turn in a conversation. But the untrimmed string is what the API
 * measures — 4,000 characters plus a trailing newline is 4,001 on the wire — and a local
 * check that disagreed with the server would present as a send failing for no visible reason.
 */
export function checkLength(body: string): LengthVerdict {
  if (body.trim() === '') {
    return 'empty'
  }

  return body.length > MAX_MESSAGE_LENGTH ? 'too-long' : 'ok'
}

/**
 * Whether the encounter can accept a message right now.
 *
 * THIS IS THE ONE PLACE THE CHAT SURFACE DIVERGES FROM THE NOTE EDITOR BESIDE IT, and the
 * divergence is the backend's. `ClinicalNoteController` deliberately accepts a note after the
 * consultation closes — "a clinician who was still typing when they pressed End must not lose
 * it". `ConsultationMessageController::assertStillInProgress` deliberately refuses a message
 * with a 409, and says why: a patient typing into a closed consultation "reasonably believes
 * a clinician is reading it. Nobody is."
 *
 * So on this screen, after End, the note editor stays and the composer goes. That looks
 * inconsistent and is not: one is addressed to the record, the other to a person.
 *
 * READING IS NOT GATED and must not be. The transcript stays for ever — it is part of the
 * medical record, and a record you cannot read back is not one.
 */
export function canSend(consultation: { readonly ended_at?: string | null } | null): boolean {
  return consultation !== null && (consultation.ended_at ?? null) === null
}

/** Which side of the conversation a line belongs to, from the viewer's seat. */
export type MessageSide = 'mine' | 'theirs'

/**
 * Attribute one line, from the server's recorded author role and the role this viewer holds.
 *
 * `author_role` IS DENORMALISED ONTO THE ROW BY THE SERVER, derived from the authorisation
 * decision that permitted the write and never from anything the client sent. So this compares
 * two role words and never two identifiers — which is what keeps a transcript readable years
 * later when the account that wrote a line has been deactivated, and what stops attribution
 * depending on a user lookup that may no longer resolve.
 *
 * AN UNRECOGNISED ROLE IS `theirs`. It cannot be produced by the current API. If it ever
 * were, attributing an unknown line to the person reading it is the one outcome that could
 * put words in their mouth — and on this side of the screen those words are a clinical
 * instruction the clinician would be held to.
 */
export function sideOf(message: ConsultationMessage, viewer: string): MessageSide {
  return message.author_role === viewer && viewer !== '' ? 'mine' : 'theirs'
}

/**
 * Why a send did not land. A CLOSED SET, and the API's own sentence is never forwarded —
 * the same discipline `ConsultationRoom`'s `classify()` already applies to `?problem=`.
 *
 *   ended     the consultation was closed while this was being typed (409)
 *   refused   not a consultation this person may write in (403/404)
 *   session   signed out, or the CSRF token went stale on a page left open (401/419)
 *   too-long  the API measured it over the limit (422)
 *   offline   the request never completed — no status came back at all
 *   failed    anything else
 */
export type SendFailure = 'ended' | 'refused' | 'session' | 'too-long' | 'offline' | 'failed'

export function classifyFailure(status: number | null): SendFailure {
  if (status === null) {
    return 'offline'
  }

  if (status === 409) {
    return 'ended'
  }

  if (status === 403 || status === 404) {
    return 'refused'
  }

  if (status === 401 || status === 419) {
    return 'session'
  }

  if (status === 422) {
    return 'too-long'
  }

  return 'failed'
}

/**
 * What a send attempt resolved to. A VALUE, never a thrown error.
 *
 * `api/notes.ts` states the rule for this domain and it applies here unchanged: "a thrown
 * server action in a client component becomes an error boundary, and an error boundary in
 * the middle of a consultation is a clinician losing their screen with a patient watching."
 */
export type SendResult = { readonly ok: true } | { readonly ok: false; readonly reason: SendFailure }

/**
 * WHICH OF FOUR THINGS THE CHAT PANEL IS SHOWING. One decision, taken once, in a function a
 * test can drive — because three of the four look alike on screen and mean different things.
 *
 *   unreadable   the transcript could not be read. NOT the same as an empty one: drawing an
 *                empty conversation over a real one means a clinician answering a patient
 *                who, as far as this screen is concerned, has said nothing.
 *   not-started  no consultation record yet, so there is nothing for a message to belong to.
 *   closed       the encounter has ended and the API answers 409.
 *   composing    the box is drawn, and it works.
 *
 * THE ORDER OF THE TESTS IS PART OF THE ANSWER. `unreadable` first, so a failure to read
 * never presents as "the consultation has not started" — a claim about the encounter rather
 * than an honest report about this screen.
 */
export type ChatPanelState = 'unreadable' | 'not-started' | 'closed' | 'composing'

export function chatPanelState(
  consultation: { readonly ended_at?: string | null } | null,
  messages: readonly unknown[] | null,
): ChatPanelState {
  if (messages === null) {
    return 'unreadable'
  }

  if (consultation === null) {
    return 'not-started'
  }

  return canSend(consultation) ? 'composing' : 'closed'
}

/**
 * WHERE A CLINICIAN'S HALF-TYPED MESSAGE LIVES BETWEEN RENDERS.
 *
 * `localStorage`, and under its OWN prefix rather than the note's — because a chat draft and
 * a note draft are different shapes and a sweep that could not tell them apart would be a
 * sweep nobody could reason about.
 *
 * ====================================================================================
 * THE OBLIGATION THAT COMES WITH THE PREFIX, WHICH IS THE POINT OF NAMING IT HERE
 * ====================================================================================
 *
 * Acceptance criterion 7: "No clinical data persists in client storage beyond the active note
 * draft." A chat draft is clinical data in client storage, so it is inside that criterion and
 * `clearAllDrafts()` HAS TO SWEEP IT. That function walks `localStorage` matching a prefix;
 * a second prefix it did not know about would leave a clinician's half-written message on a
 * shared clinic handset after sign-out, silently, with the sweep reporting success.
 *
 * `model/drafts.ts` records that exact failure happening once already — the contract named
 * `clearAllDrafts()` while the code defined `clearAllNoteDrafts()`, so "a reader grepping for
 * the wiring found a claim and no code". Both prefixes are exported from this domain's model
 * layer, `clearAllDrafts` reads both, and `clearDrafts.test.ts` asserts a chat draft is gone
 * after a sweep. A prefix added here without that test is the same defect again.
 *
 * WHY `localStorage` HERE AND `sessionStorage` IN THE PATIENT PORTAL. The console can pay for
 * the stronger storage because it owns a sign-out control that clears it — `SignOutSubmit`
 * lives in this domain for precisely that reason. The portal's sign-out is a Server Action
 * and a server cannot reach into browser storage, so a patient's draft is scoped to the tab
 * instead. Two different guarantees, each matched to what the surface can actually enforce.
 */
export const CHAT_DRAFT_PREFIX = 'carevelo.chat-draft.v1.'

/**
 * Scoped by user AND consultation, exactly as `draftKey()` in model/drafts.ts is, and for the
 * same reason: a second clinician signing in on the same handset finds their own empty box
 * rather than a colleague's half-written instruction. That is a mitigation and not the
 * control — the control is the sweep on sign-out.
 */
export function chatDraftKey(userId: string, consultationId: string): string {
  return `${CHAT_DRAFT_PREFIX}${userId}.${consultationId}`
}
