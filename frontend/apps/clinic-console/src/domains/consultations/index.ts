/**
 * The consultations domain's PUBLIC SURFACE.
 *
 * The clinician consultation room — the video pane, the CHAT PANEL, the patient's history
 * within this tenant, the SOAP note editor and the record — on one mobile-first screen.
 * Everything else in this folder is internal, and `.dependency-cruiser.cjs` makes reaching
 * past this file a build failure rather than a code-review note.
 *
 * THE CHAT PANEL IS NEW AND IT CLOSES AN ASYMMETRY RATHER THAN ADDING A FEATURE. The patient
 * portal has carried a chat panel since it was built — honestly saying that typing there
 * would reach nobody — while this console carried nothing at all, not even a placeholder, and
 * `ModeControl` has always offered the clinician the choice of stepping the consultation down
 * into `chat`. A mode with no surface behind it is a clinical record that says the encounter
 * was held by chat when nothing on either side could carry one.
 *
 * Nothing new is exported for it. The panel is composed inside `ConsultationRoom` and the
 * transcript arrives on `RoomState`, so the route's call is unchanged — which is the whole
 * point of `loadRoom` being one function: reads are audited, and a screen that fetched its
 * own transcript would put a second `consultation_message.viewed` in the trail for one
 * screen.
 *
 * ------------------------------------------------------------------------------------
 * WHAT IS BEHIND THIS LINE AND MUST STAY THERE
 *
 * The join-token flow — issue, redeem, the single-use accounting and the HTTP-only cookie that
 * remembers an entry — is exactly the kind of thing that should have one way in. So is the
 * decision about whether an appointment may be entered, which reads the appointment's status
 * and times and is the reason this domain knows about appointments at all. A screen that
 * wanted "just the credentials" would be a screen able to open a room without spending a
 * token, and the whole point of two calls is that nobody can.
 *
 * The draft storage contract is behind here too — the note's, and now the chat composer's.
 * These are the only clinical data this product may put in client storage, and the rules that
 * make that survivable — cleared on submission, cleared on sign-out, conflicts shown and never
 * resolved — belong in one place. THERE ARE TWO PREFIXES NOW, `carevelo.note-draft.v1.` and
 * `carevelo.chat-draft.v1.`, and `clearAllDrafts()` sweeps both. A third added without
 * extending that sweep would leave clinical text on a shared clinic handset after a sign-out
 * that reported success — see the long note on the function itself.
 *
 * ------------------------------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 *   const state = await loadRoom(appointmentId)
 *
 *   <ConsultationRoom
 *     state={state}
 *     paths={{ room, day }}
 *     userId={staff.id}
 *     clinicPhone={…}
 *     prescribing={<PrescribingPanel … />}   // from the prescriptions domain
 *     problem={searchParams.problem}
 *     message={searchParams.message}
 *   />
 *
 * `prescribing` IS A SLOT AND NOT AN IMPORT. The prescribing form belongs to the prescriptions
 * domain; composing two domains is the route's job and the boundary rules enforce the
 * direction. This domain decides only where on the screen it goes.
 *
 * `userId` scopes the note draft's local storage key, so a second clinician signing in on the
 * same handset finds their own empty editor rather than a colleague's text.
 *
 * The route is still responsible for what routes are responsible for: resolving the session,
 * sending a guest to sign in, and refusing a member of staff who is not a clinician before the
 * screen offers them a door the API would shut.
 *
 * ------------------------------------------------------------------------------------
 * THE LOOSE END THAT WAS NAMED HERE IS TIED
 *
 * `clearAllDrafts()` exists so the identity domain's sign-out path can satisfy acceptance
 * criterion 7 — "no clinical data persists in client storage beyond the active note draft".
 * This paragraph used to say that nothing called it, because the console had no sign-out
 * control; it has one now, and `domains/identity/components/SignOutSubmit.tsx` makes the
 * call on the press that signs out. It is exported from here and only from here, so that
 * there is exactly one function to call and no temptation to reimplement the key format in
 * the identity domain — where a mismatched prefix would fail silently and leave a previous
 * clinician's notes on a shared clinic handset.
 *
 * It was also called `clearAllNoteDrafts()` here while `model/drafts.ts` specified
 * `clearAllDrafts()`, so the name the contract used appeared nowhere in the product and a
 * reader looking for the wiring reasonably concluded there was none. One name now, and it is
 * the specification's.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md
 * @see docs/30-architecture/frontend-nextjs.md:132 — notes must never be lost
 */

/* ---- The screen ---- */
export { ConsultationRoom, type ConsultationRoomProps } from './components/ConsultationRoom'

/* ---- What the route must load before it can render one ---- */
export { loadRoom, type RoomState } from './api/entry'

/* ---- The draft's storage contract, for sign-out. See above. ---- */
export { clearAllDrafts } from './components/clearDrafts'

/* ---- Types, all of them from the generated contract ---- */
export type {
  ClinicalNote,
  Consultation,
  ConsultationMode,
  ConsultationOutcome,
  ConsultationPaths,
} from './model/types'

/* ---- The one fact the prescribing panel needs from this domain ----
   Whether a consultation's outcome permits prescribing at all. Exported so the prescriptions
   domain reads the rule from the domain that owns the encounter rather than keeping a second
   copy of `ConsultationOutcome::permitsPrescribing()` that could drift from it. */
export { permitsPrescribing } from './model/types'

/* ---- The browser-side half of signing out ----
   `SignOutSubmit` is the sign-out button, and it lives here rather than in identity because
   it calls `clearAllDrafts` and a 'use client' module drags its whole import graph into the
   browser bundle — a button in identity importing this barrel pulled ConsultationRoom and the
   realtime gateway in with it and failed the build. The drafts are this domain's, so the
   control that clears them is too; `app/sign-out/page.tsx` composes it with identity's
   screen, which is what `no-cross-domain-internals` recommends in its own comment. */
export { SignOutSubmit } from './components/SignOutSubmit'
