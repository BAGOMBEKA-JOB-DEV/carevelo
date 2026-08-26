import type { components } from '@carevelo/api-client'

/**
 * Consultation chat, reduced to the judgements a machine can get wrong — and nothing that
 * touches a browser, a cookie or the network, so every one of them is executable by a test.
 *
 * ====================================================================================
 * A MESSAGE IS A CLINICAL INSTRUCTION. THAT SETS EVERY RULE BELOW.
 * ====================================================================================
 *
 * "Take two of these tonight and stop the other one" is a sentence a patient will act on,
 * and it arrives through this surface exactly as a prescription's directions do. Three
 * consequences, and each is a function in this file rather than a paragraph somewhere:
 *
 *   1. IT IS NEVER TRUNCATED. Not on the way out, not on the way in, not in a preview. The
 *      backend's limit is 4,000 characters (`StoreConsultationMessageRequest`), and the
 *      composer's answer to a longer one is to REFUSE IT AND SAY SO — never to send the
 *      first 4,000 and drop the rest, which is how "…and stop the other one" disappears.
 *      `checkLength()` is that decision.
 *   2. IT IS NEVER MISATTRIBUTED. Which side said a thing is part of what it means, and a
 *      transcript that puts the clinician's instruction under the patient's name is worse
 *      than no transcript. `sideOf()` decides it from the server's own `author_role` and
 *      the role this viewer holds, and never from a guess about ordering or styling.
 *   3. IT IS NEVER SILENTLY DROPPED. A composer that accepts text which reaches nobody is
 *      the thing the old placeholder panel refused to be — "a message box that silently
 *      drops what a patient types about their own health is worse than no box". So the
 *      composer is not rendered at all when the encounter cannot accept one, which is
 *      `canSend()`, and every failed send resolves to a sentence rather than to nothing.
 *
 * ====================================================================================
 * WHY A FAILURE IS A CODE AND NEVER THE API'S OWN STRING
 * ====================================================================================
 *
 * The same closed-set discipline `api/actions.ts` already applies to `?entry=`: a screen
 * that renders an arbitrary string handed to it is a screen that can be made to say
 * anything, and this one sits next to a telephone number a patient is being asked to trust.
 * `classifyFailure()` maps a status to one of six words; the words map to catalogue
 * sentences. Nothing from the wire is ever printed.
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
 * backend's limit rises this number is merely conservative and a patient is told to shorten
 * something that would have been accepted. If the backend's limit FALLS, this number lets a
 * message through to a 422 — which `classifyFailure` turns into the same sentence the local
 * check would have shown. Both ends fail towards telling the person, never towards sending
 * a fragment.
 */
export const MAX_MESSAGE_LENGTH = 4_000

/** What is wrong with what has been typed, if anything. */
export type LengthVerdict = 'empty' | 'too-long' | 'ok'

/**
 * May this be sent as it stands?
 *
 * TRIMMED FOR THE EMPTINESS TEST AND MEASURED UNTRIMMED FOR THE LENGTH TEST, deliberately.
 * Whitespace is not a turn in a conversation, so a box holding three spaces is `empty` and
 * the send is not offered. But the untrimmed string is what is measured against the limit,
 * because the untrimmed string is what the API measures — a message that is 4,000
 * characters of text plus a trailing newline is 4,001 on the wire, and a local check that
 * disagreed with the server would present as a send that fails for no visible reason.
 */
export function checkLength(body: string): LengthVerdict {
  if (body.trim() === '') {
    return 'empty'
  }

  return body.length > MAX_MESSAGE_LENGTH ? 'too-long' : 'ok'
}

/**
 * Whether the encounter can accept a message at all right now.
 *
 * THE COMPOSER IS NOT RENDERED WHEN THIS IS FALSE, rather than being rendered disabled or
 * rendered and failing. `ConsultationMessageController::assertStillInProgress` answers 409
 * for an ended consultation, and it explains why the endpoint is closed rather than merely
 * quiet: "a patient types a new symptom into a closed consultation, sees it delivered, and
 * reasonably believes a clinician is reading it. Nobody is." A box on screen makes exactly
 * that promise, so the box goes.
 *
 * Null is `false` too — before the clinician starts, there is no consultation record for a
 * message to belong to, and the API would answer 404. The room already says plainly that
 * nobody has started yet, which is the true and useful thing to say at that moment.
 *
 * READING IS NOT GATED BY THIS and must not be. The transcript stays on screen for ever:
 * the conversation is part of the medical record, and a record you cannot read back is not
 * one. `index` on the API is open after the encounter ends for the same reason.
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
 * decision that permitted the write and never from anything the client sent. So this
 * compares two role words and never two identifiers — which is what keeps a transcript
 * readable years later when the account that wrote a line has been deactivated, and what
 * stops the attribution depending on a user lookup that may no longer resolve.
 *
 * AN UNRECOGNISED ROLE IS `theirs`. It cannot be produced by the current API — the column
 * holds one of two values — but if it ever were, attributing an unknown line to the person
 * reading it is the one outcome that could put words in their mouth. Falling the other way
 * merely shows an unattributed line, which is recoverable by asking.
 */
export function sideOf(message: ConsultationMessage, viewer: string): MessageSide {
  return message.author_role === viewer && viewer !== '' ? 'mine' : 'theirs'
}

/**
 * Why a send did not land. A CLOSED SET — see the header.
 *
 *   ended     the clinician closed the consultation while this was being typed (409)
 *   refused   this is not a consultation this person may write in (403/404)
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

  // 409 is the encounter having ended, which is the only conflict this endpoint raises.
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
 * A thrown Server Action inside a client component becomes an error boundary, and an error
 * boundary in the middle of a consultation is a patient losing the screen they are being
 * treated on. `api/notes.ts` in the console makes the same choice for the same reason, in
 * those words. Every failure here is a value the composer renders beside the box, with the
 * text still in it.
 */
export type SendResult = { readonly ok: true } | { readonly ok: false; readonly reason: SendFailure }

/**
 * WHERE A PATIENT'S HALF-TYPED MESSAGE LIVES BETWEEN RENDERS, and why it is not
 * `localStorage`.
 *
 * The requirement is that a draft survives a navigation — the room re-renders on its own
 * every fifteen seconds when the clinician changes something, and a patient mid-sentence
 * when that lands must not lose the sentence. `sessionStorage` covers that completely: it
 * survives a re-render, a reload and a same-tab navigation, and it is the same origin's
 * storage with the same synchronous API.
 *
 * WHAT IT ALSO DOES, WHICH IS THE REASON IT WON. It is scoped to the TAB, and it is gone
 * when the tab is. The console's note draft is in `localStorage` because a clinician's
 * half-written note is the only record of what was said and must outlive a crashed browser
 * — and the console pays for that with `clearAllDrafts()` on a sign-out control that
 * domain owns. The patient portal's sign-out is a Server Action, and a server cannot reach
 * into browser storage; wiring the equivalent would mean a client component inside the
 * identity domain, which this work does not own. Rather than leave a patient's own words
 * about their health sitting in a borrowed handset's `localStorage` with nothing arranged
 * to remove them, the draft is tab-scoped, which needs no sweep to be correct.
 *
 * IT IS STILL CLINICAL DATA IN CLIENT STORAGE. The key is versioned and scoped to the
 * consultation, the composer clears it the moment the message is on the server, and the
 * whole of it disappears with the tab.
 */
export const CHAT_DRAFT_PREFIX = 'carevelo.chat-draft.v1.'

export function chatDraftKey(consultationId: string): string {
  return `${CHAT_DRAFT_PREFIX}${consultationId}`
}

/**
 * One message body, split into the lines it was typed as.
 *
 * ====================================================================================
 * WHY A SPLIT AND NOT `white-space: pre-wrap`, WHICH WOULD BE THE OBVIOUS ANSWER
 * ====================================================================================
 *
 * The console renders a clinical note into a `<pre class="verbatim">` for exactly this
 * reason — "a clinician's line breaks are part of what they wrote, and collapsing them
 * changes the note". That class lives in the console's own `console.css`. The patient portal
 * has no stylesheet of its own; it imports `@carevelo/ui/tokens.css` and nothing else, and
 * there is no `pre-wrap` utility anywhere in that package. Adding one means editing a
 * package four apps share, for one element, from a change that owns neither — and an inline
 * `style={{ whiteSpace: 'pre-wrap' }}` is banned by an ESLint rule that is right to ban it.
 *
 * So the break is carried by the LAYOUT instead of by a CSS property: one paragraph per
 * line, inside a `Stack`, which is spacing this design system already owns.
 *
 * ====================================================================================
 * WHAT IT GUARANTEES, AND THE ONE THING IT DOES NOT
 * ====================================================================================
 *
 * GUARANTEED: every line with anything in it survives, in order, with its text byte-for-byte
 * unchanged. Nothing is shortened, nothing is ellipsised, nothing is reordered. That is the
 * property `chat.test.ts` drives, because a clinical instruction that loses its second half
 * reads as a complete and different instruction.
 *
 * NOT GUARANTEED: a run of blank lines. Three consecutive newlines render as one break
 * rather than three. That is a loss of typographic intent and not a loss of content, and it
 * is the price of not owning a stylesheet. It is written down rather than left to be
 * discovered.
 */
export function messageLines(body: string): string[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '')
}

/**
 * WHICH OF FOUR THINGS THE CHAT PANEL IS SHOWING. One decision, taken once, in a function a
 * test can drive — because three of the four look similar on screen and mean entirely
 * different things.
 *
 *   unreadable   the transcript could not be read at all. NOT the same as an empty one, and
 *                the distinction is the whole reason this is a four-way and not a three-way:
 *                drawing an empty conversation over a real one, on a screen where a clinician
 *                may have written "go to the hospital now", is the worst available answer.
 *                No composer either — a message sent into a consultation we cannot read back
 *                is a message nobody can confirm arrived.
 *   not-started  no consultation record yet. The clinician has not opened it, the API would
 *                answer 404, and the room already says so above.
 *   closed       the encounter has ended. `assertStillInProgress` answers 409 and explains
 *                itself: a patient typing a new symptom into a closed consultation
 *                "reasonably believes a clinician is reading it. Nobody is."
 *   composing    the box is drawn, and it works.
 *
 * THE ORDER OF THE TESTS IS PART OF THE ANSWER. `unreadable` is checked first, so a failure
 * to read never presents as "the consultation has not started" — which would be a lie about
 * the encounter rather than an honest report about this screen.
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
