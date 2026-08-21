import { ApiError } from '@carevelo/api-client'
import { readingApi, writingApi } from './gateway'
import type { NoteSection } from '../model/drafts'
import type { ClinicalNote } from '../model/types'

/**
 * Reading and writing the clinical note — and the one thing this whole domain exists to get
 * right: NEVER LOSING ONE, AND NEVER SILENTLY RESOLVING A DISAGREEMENT ABOUT ONE.
 *
 * ====================================================================================
 * NOTES ARE APPEND-ONLY. THERE IS NO EDIT AND THERE IS NO DELETE.
 * ====================================================================================
 *
 * `ClinicalNoteController` has an `index`, a `store` and an `addendum`, and their absence of a
 * sibling is the design: "A note is corrected by adding an addendum that supersedes it; the
 * original stays readable forever. A medical record that can be silently rewritten is not a
 * medical record, and no role — clinician, administrator or Carevelo — is given a route around
 * that."
 *
 * So this file exposes no `update` and no `remove`, and nothing in the components renders a
 * delete control. THE CAPABILITY DELIBERATELY DOES NOT EXIST. A greyed-out bin icon would be
 * worse than nothing: it teaches a clinician that deletion is a thing that happens here and
 * that somebody merely has not been given permission.
 *
 * ====================================================================================
 * EVERY SAVE IS A NEW ROW, AND THAT SHAPES THE DEBOUNCE
 * ====================================================================================
 *
 * `store()` says it outright: "Each save is a new row rather than an overwrite, because the
 * model forbids overwriting a body at all." A draft synced every second appends a hundred
 * half-sentences to a permanent record. See `SYNC_DEBOUNCE_MS` in model/drafts.ts for the
 * judgement that follows from it, and `NoteThread` for how the successive saves are presented
 * to a reader without pretending the earlier ones are not there.
 *
 * ====================================================================================
 * THE CONFLICT RULE
 * ====================================================================================
 *
 * On reconnect the local draft is reconciled with the server, and ANY CONFLICT IS SHOWN
 * RATHER THAN SILENTLY RESOLVED. Mechanically:
 *
 *   - the editor remembers the id of the note its last successful sync created;
 *   - a save asks for the newest note in this section first;
 *   - if that is not the note the editor remembers, SOMETHING ELSE WROTE — a second tab, a
 *     second device, a colleague — and the save is refused with both texts returned;
 *   - the clinician decides. Their choices are "keep mine as well" and "discard mine". There
 *     is no merge, because a machine merging two accounts of the same encounter is a machine
 *     inventing a third.
 *
 * NOTHING IS EVER LOST BY EITHER ANSWER. The server's note is immutable and stays. The local
 * draft stays in browser storage until the clinician acts. "Keep mine as well" appends;
 * because notes are append-only, that is not an overwrite and never can be.
 *
 * @see docs/30-architecture/frontend-nextjs.md:132
 * @see backend/app/Http/Controllers/Api/V1/ClinicalNoteController.php
 */

/**
 * Every note on the consultation, oldest first, superseded ones included.
 *
 * READS ARE AUDITED. `index()` writes `clinical_note.viewed` with a count — "who looked at my
 * records?" can only be answered by having recorded every look. Worth knowing before adding a
 * call: this is not a free read, and polling it every second would fill a clinic's audit trail
 * with one clinician looking at their own screen.
 */
export async function listNotes(consultationId: string): Promise<ClinicalNote[] | null> {
  try {
    const api = await readingApi()
    const response = await api.get<{ data: ClinicalNote[] }>(
      `/v1/consultations/${encodeURIComponent(consultationId)}/notes`,
    )

    return response.data
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null
    }

    throw error
  }
}

export type SaveResult =
  | { kind: 'saved'; note: ClinicalNote }
  /**
   * Somebody else wrote in this section. BOTH texts travel back; the caller shows both.
   * `theirs` is the note now on the server, `mine` is exactly what was submitted, echoed so
   * the screen can put them side by side without trusting the browser to still hold it.
   */
  | { kind: 'conflict'; theirs: ClinicalNote; mine: string }
  | { kind: 'problem'; message: string | null }

export type SaveDraftRequest = {
  consultationId: string
  section: NoteSection
  body: string
  /**
   * The note this browser last synced in this section, or null if it has never synced one.
   *
   * NULL IS NOT "NO CHECK". A browser that has never synced, arriving at a consultation that
   * already has notes in this section, is precisely the resumed-on-another-device case — so
   * an existing note is a conflict there too, and the clinician is shown what is already
   * recorded before they add to it.
   */
  baseNoteId: string | null
  /**
   * The clinician has SEEN the other version and chosen to add theirs as well.
   *
   * Skips the check and appends. It is not an override of anything: notes are append-only, so
   * "keep mine as well" cannot destroy the other text and never could. The flag exists so
   * that the check cannot be skipped by accident — a caller has to have been told about the
   * conflict to be in a position to set it.
   */
  force?: boolean | undefined
}

/**
 * Save a section, including a half-finished one.
 *
 * DELIBERATELY PERMISSIVE ABOUT COMPLETENESS, because the endpoint is: "a lost connection
 * must never lose clinical text, and validation that demanded a complete note would guarantee
 * it did". An unfinished sentence is stored as an unfinished sentence.
 *
 * AN EMPTY BODY IS NOT SENT. Not for validation reasons — the API would take it — but because
 * an empty row in a clinical record says something ("the clinician recorded nothing here")
 * that a clinician who simply has not typed yet did not mean to say.
 */
export async function saveDraft(request: SaveDraftRequest): Promise<SaveResult> {
  const body = request.body.trim()

  if (body === '') {
    return { kind: 'problem', message: 'There is nothing to save in this section yet.' }
  }

  if (request.force !== true) {
    const conflict = await detectConflict(request)

    if (conflict !== null) {
      return { kind: 'conflict', theirs: conflict, mine: request.body }
    }
  }

  try {
    const api = await writingApi()
    const response = await api.post<{ data: ClinicalNote }>(
      `/v1/consultations/${encodeURIComponent(request.consultationId)}/notes`,
      { body: request.body, note_type: request.section },
    )

    return { kind: 'saved', note: response.data }
  } catch (error) {
    return { kind: 'problem', message: sentence(error) }
  }
}

/**
 * Has the server moved since this browser last synced this section?
 *
 * Returns the note that moved it, or null.
 *
 * A FAILED CHECK IS NOT A CONFLICT. If the notes cannot be read at all — the connection this
 * whole design exists to survive — the save proceeds. The alternative is refusing to save
 * clinical text because we could not confirm nobody else had written any, which turns a
 * network blip into exactly the data loss the requirement forbids. The cost of being wrong is
 * one extra appended note in a record where nothing is ever overwritten.
 */
async function detectConflict(request: SaveDraftRequest): Promise<ClinicalNote | null> {
  const notes = await listNotes(request.consultationId).catch(() => null)

  if (notes === null) {
    return null
  }

  const newest = newestInSection(notes, request.section)

  if (newest === null) {
    // Nothing on the server in this section. Whatever this browser thinks it synced, there is
    // nothing here to disagree with.
    return null
  }

  if (newest.id === request.baseNoteId) {
    // The server's newest is the one this browser put there. No divergence.
    return null
  }

  /*
   * One deliberate exception, and it is the difference between a useful warning and an alarm
   * nobody reads. If the server's newest note in this section says EXACTLY what this browser
   * last synced, then whatever created it is not a divergence — the same text arrived twice,
   * most often from this same clinician's second tab. Two identical accounts of an encounter
   * are not two accounts.
   */
  if (request.baseNoteId !== null && newest.body === request.body) {
    return null
  }

  return newest
}

/** The newest note in one section, superseded ones included. The index returns oldest first. */
function newestInSection(notes: readonly ClinicalNote[], section: NoteSection): ClinicalNote | null {
  const inSection = notes.filter((note) => note.note_type === section)

  return inSection[inSection.length - 1] ?? null
}

/**
 * Correct a note by adding an addendum.
 *
 * PATCH, BUT NOTHING IS PATCHED. The response is a NEW note of type `addendum` carrying
 * `supersedes_note_id`; the note named in the path is untouched and is still returned by
 * `index()`. Attempting to change its body instead throws inside the model.
 *
 * That is the only correction mechanism in this product, and the screens say so in those
 * words. A clinician who wrote the wrong dose does not fix the sentence — they write a new
 * one that supersedes it, and both stay readable for ever, which is what makes the record
 * worth anything at all.
 *
 * A NOTE FROM ANOTHER ENCOUNTER IS A 404, NOT A 403, and the controller is explicit about
 * why: "A 403 would confirm the note exists, and which encounter a note belongs to is itself
 * health information."
 */
export async function addAddendum(
  consultationId: string,
  noteId: string,
  body: string,
): Promise<SaveResult> {
  if (body.trim() === '') {
    return { kind: 'problem', message: 'An addendum needs some text.' }
  }

  try {
    const api = await writingApi()
    const response = await api.patch<{ data: ClinicalNote }>(
      `/v1/consultations/${encodeURIComponent(consultationId)}/notes/${encodeURIComponent(noteId)}`,
      { body },
    )

    return { kind: 'saved', note: response.data }
  } catch (error) {
    return { kind: 'problem', message: sentence(error) }
  }
}

function sentence(error: unknown): string | null {
  return error instanceof ApiError ? error.message : null
}
