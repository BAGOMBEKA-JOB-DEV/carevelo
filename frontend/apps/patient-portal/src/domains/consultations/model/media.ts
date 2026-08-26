/**
 * The media leg's decision logic, with nothing in it that can reach a browser, a cookie or
 * the network — so that the two judgements below can be executed by a test rather than
 * reasoned about in a review.
 *
 * ====================================================================================
 * THE COERCION TRAP, WHICH IS THE WHOLE REASON THIS FILE EXISTS
 * ====================================================================================
 *
 * `configured` crosses the wire as the STRING `'true'` or the STRING `'false'`, because
 * `VideoProvider::credentialsFor()` is contracted as `array<string, string>` and both
 * implementations honour that — `UnconfiguredVideoProvider` returns `'false'` and
 * `LiveKitVideoProvider` returns `'true'`, each with a comment on the PHP side saying why
 * neither may quietly become a real boolean.
 *
 * `Boolean('false')` is `true`. So the single most natural line anybody could write here —
 * `configured: Boolean(credentials.configured)` — opens a dead room for every patient of
 * every clinic that has not deployed a media server, which is all of them until one is
 * deployed, and it does it while the types still check and the tests still pass.
 *
 * That comparison used to live inline in `api/room.ts`, in a module that imports
 * `next/headers` and therefore cannot be loaded by the unit runner at all. So the trap was
 * documented in three places and asserted in none. It is one exported function now, and
 * `media.test.ts` drives the exact value that springs it.
 *
 * ====================================================================================
 * WHAT THE PROVIDER IS EVER TOLD, RESTATED ON THIS SIDE OF THE WIRE
 * ====================================================================================
 *
 * A room name (`apt-{ulid}`, opaque) and a participant LABEL — the role, never the person.
 * The backend enforces that list in `LiveKitVideoProvider::PARTICIPANT_LABELS` and throws
 * rather than substituting, because a participant identity is broadcast to everyone else in
 * the room and is written into the media server's own operational logs, which sit on a VPS
 * outside the tenant database and outside row-level security. `asParticipant()` below is
 * this side's copy of that closed list, and it exists so that a screen saying "you are
 * joined as …" renders one of two known words rather than whatever arrived in a cookie.
 *
 * @see backend/app/Support/Video/UnconfiguredVideoProvider.php
 * @see backend/app/Support/Video/LiveKitVideoProvider.php
 * @see docs/70-decisions/0004-video-provider-selection.md
 */

/**
 * The only value that means "a media server is configured for this clinic".
 *
 * Named rather than inlined so that the literal and the comparison cannot drift apart, and
 * so a grep for it finds every place the decision is taken.
 */
export const CONFIGURED = 'true'

/**
 * Read the platform's `configured` flag off the redeem response.
 *
 * STRICT EQUALITY AGAINST THE STRING, AND NOTHING ELSE IS TRUE. Not `'TRUE'`, not `'1'`,
 * not the boolean `true`, not a non-empty string. The rule is deliberately harsh in the
 * direction of the honest fallback: every value this function does not recognise resolves
 * to "no media server", which shows the patient the clinic's telephone number. The opposite
 * default — anything unrecognised means configured — shows them a room with nothing in it
 * and no way out, which is the exact failure the flag was added to prevent.
 *
 * A real boolean `true` therefore reads as NOT configured, and that is intentional rather
 * than an oversight: it can only arrive if somebody changed the PHP contract, and failing
 * closed on that change surfaces it on a developer's screen instead of a patient's.
 */
export function isMediaConfigured(value: unknown): boolean {
  return value === CONFIGURED
}

/** The two labels a participant may ever carry. A ROLE, never a person. */
export const PARTICIPANT_LABELS = ['patient', 'clinician'] as const

export type ParticipantLabel = (typeof PARTICIPANT_LABELS)[number]

/**
 * Narrow a stored participant label to the closed set, or null.
 *
 * Null rather than a fallback to `'patient'`: mislabelling which side of a consultation
 * somebody is on is not the kind of thing to paper over with a default, and the screens
 * that use this simply omit the line when it cannot be established.
 */
export function asParticipant(value: unknown): ParticipantLabel | null {
  return typeof value === 'string' && (PARTICIPANT_LABELS as readonly string[]).includes(value)
    ? (value as ParticipantLabel)
    : null
}

/**
 * What the media pane should draw, decided in one place.
 *
 *   unconfigured  no media server for this clinic. The honest degradation: say so, and give
 *                 the telephone number. This is the state every clinic is in today.
 *   no-client     a media server IS configured and brokered a session, and this build has
 *                 no client able to open it. See VideoStage — that is the seam.
 *
 * THERE IS NO `ready` MEMBER, and its absence is the honest part. A third state would be a
 * branch nothing in this build can reach, type-checked and never executed, which is exactly
 * the shape of thing this codebase keeps finding: fully described, fully exported, never
 * once run. When the client SDK lands, `ready` is added here, `VideoStage` grows the branch
 * that renders it, and the test below fails until both are done.
 */
export type MediaState = 'unconfigured' | 'no-client'

/**
 * @param configured Already coerced by `isMediaConfigured` upstream, in `api/room.ts`,
 *                   which is the only place the wire value is read.
 */
export function mediaState(configured: boolean): MediaState {
  return configured ? 'no-client' : 'unconfigured'
}
