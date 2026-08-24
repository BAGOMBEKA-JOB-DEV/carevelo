/**
 * THE NOTE DRAFT: the only clinical data this product is permitted to put in client storage,
 * and the rules that make that permission survivable.
 *
 * ====================================================================================
 * THIS IS A HARD REQUIREMENT, NOT AN OPTIMISATION
 * ====================================================================================
 *
 * docs/30-architecture/frontend-nextjs.md:132, in those words: "Draft notes persist to local
 * storage as they are typed and sync to the API on a debounce. A dropped connection loses
 * nothing; on reconnect, the local draft is reconciled with the server and any conflict is
 * shown rather than silently resolved."
 *
 * Two things follow that the rest of this file exists to hold:
 *
 *   1. LOCAL STORAGE IS THE GUARANTEE. The network is not. A clinician on a mid-range Android
 *      in a consulting room with one bar loses the connection routinely; if the text only
 *      exists in a React state tree, closing the tab loses the only record of what was said.
 *      So every keystroke is written locally, synchronously, before anything is attempted
 *      over the wire.
 *   2. A CONFLICT IS SHOWN. Never merged, never last-write-wins, never quietly dropped. This
 *      is a clinical record: two divergent accounts of the same encounter is a fact a human
 *      has to resolve, and a machine that picks one is a machine that has destroyed evidence.
 *
 * ====================================================================================
 * AND IT IS THE ONLY THING ALLOWED IN THERE
 * ====================================================================================
 *
 * Acceptance criterion 7: "No clinical data persists in client storage beyond the active note
 * draft." Which means this file owns two obligations besides writing:
 *
 *   - CLEARED ON SUBMISSION. The moment a section is safely on the server, its draft goes.
 *   - CLEARED ON SIGN-OUT. `clearAllDrafts()` exists for exactly that and is exported from
 *     the domain's public surface so the identity domain can call it from its sign-out path.
 *     THAT CALL DOES NOT EXIST YET — the identity domain is an empty placeholder and this
 *     change does not own it. It is in the handover notes, and it is the one loose end in
 *     this design worth chasing: a shared clinic laptop where the previous clinician's draft
 *     is still in local storage is precisely the exposure the criterion is written against.
 *
 * As a partial mitigation the key is SCOPED TO THE SIGNED-IN USER as well as the
 * consultation, so a second clinician signing in on the same handset does not see the first
 * one's text — they simply find their own empty editor. It is not a substitute for clearing
 * on sign-out, and it is not presented as one.
 *
 * ====================================================================================
 * NOTHING IN HERE TOUCHES THE BROWSER
 * ====================================================================================
 *
 * This module is pure: key construction, the shape of a stored draft, and the section list.
 * That is what lets a server component import `NOTE_SECTIONS` to render the headings while the
 * client editor imports the same list to key its storage — one list, not two that can drift.
 * The actual `localStorage` calls live in the editor, wrapped, because storage throws in a
 * private window and on a browser with site data blocked.
 */

/**
 * The four SOAP sections, and the fifth thing a note can be.
 *
 * `StoreClinicalNoteRequest` accepts `subjective | objective | assessment | plan`, and refuses
 * a note with no section at all — "an unclassified note is unreadable to the next clinician".
 * `addendum` is not on that list because an addendum is never created by this endpoint; it
 * comes back from PATCH .../notes/{note} with `supersedes_note_id` set, and is only ever
 * READ here.
 */
export const NOTE_SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const

export type NoteSection = (typeof NOTE_SECTIONS)[number]

export function isNoteSection(value: string): value is NoteSection {
  return (NOTE_SECTIONS as readonly string[]).includes(value)
}

/**
 * What each section is, in the words a clinician uses.
 *
 * DELIBERATELY LOOSE PROMPTS. Over-structuring the note is, in the API's own words, "the
 * fastest way to make a clinician abandon the system": nobody dictating between rooms wants a
 * form with eleven required fields. Four boxes with a hint each is the most structure this
 * earns.
 */
export const SECTION_LABEL: Record<NoteSection, string> = {
  subjective: 'Subjective',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
}

export const SECTION_HINT: Record<NoteSection, string> = {
  subjective: 'What the patient told you, in their terms.',
  objective: 'What you observed or measured.',
  assessment: 'What you think is going on.',
  plan: 'What happens next — treatment, follow-up, referral.',
}

/**
 * How long the editor waits after the last keystroke before syncing.
 *
 * FIVE SECONDS, AND THE NUMBER IS A JUDGEMENT WITH A COST ON BOTH SIDES.
 *
 * Shorter is safer for the network and worse for the record. `ClinicalNoteController::store`
 * says it plainly: "Each save is a new row rather than an overwrite, because the model forbids
 * overwriting a body at all." So every sync appends a permanent, undeletable row to a clinical
 * record. A one-second debounce on a ten-minute consultation writes a hundred rows of
 * half-sentences into a document a clinic may have to produce in court.
 *
 * Longer is kinder to the record and worse for the guarantee. Local storage covers the gap —
 * that is its whole job — so the real exposure of a long debounce is a clinician who closes
 * the tab on a different device from the one they typed on.
 *
 * Five seconds of IDLE, plus a flush on blur and on the tab being hidden, keeps a normal
 * section to a handful of rows and never leaves unsynced text sitting behind a stopped timer.
 */
export const SYNC_DEBOUNCE_MS = 5_000

/** What is kept in local storage, per section. */
export type StoredDraft = {
  /** What the clinician has typed. The authoritative copy until a sync succeeds. */
  body: string
  /**
   * The body as it was when the last sync succeeded, and the id of the note that sync created.
   *
   * THIS PAIR IS WHAT MAKES CONFLICT DETECTION POSSIBLE. On reconnect the server is asked for
   * the newest note in this section; if it is not the one named here, something else wrote
   * while this browser was away — another device, another tab, a colleague — and both texts
   * have to be put in front of a human. Without a baseline there is no way to tell "the server
   * moved" from "I am the one who moved it", and every reconnect would either false-alarm or
   * silently overwrite.
   */
  syncedBody: string
  syncedNoteId: string | null
  /** Epoch milliseconds. Shown to the clinician so "unsaved" is a time and not a mood. */
  changedAt: number
}

/** The prefix every draft key starts with. Versioned, so a change of shape cannot misread an old one. */
export const DRAFT_PREFIX = 'carevelo.note-draft.v1.'

/**
 * The key one section's draft is stored under.
 *
 * Scoped by user AND consultation. See the header: the user scope is why a second clinician
 * on a shared handset does not read the first one's text, and it is a mitigation rather than
 * the control — the control is clearing on sign-out.
 */
export function draftKey(userId: string, consultationId: string, section: NoteSection): string {
  return `${DRAFT_PREFIX}${userId}.${consultationId}.${section}`
}
