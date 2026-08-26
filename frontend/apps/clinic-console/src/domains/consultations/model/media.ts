/**
 * The media leg's decision logic, with nothing in it that can reach a browser, a cookie or
 * the network — so that the judgements below can be executed by a test rather than reasoned
 * about in a review.
 *
 * ====================================================================================
 * THE COERCION TRAP, WHICH IS THE WHOLE REASON THIS FILE EXISTS
 * ====================================================================================
 *
 * `configured` crosses the wire as the STRING `'true'` or the STRING `'false'`, because
 * `VideoProvider::credentialsFor()` is contracted as `array<string, string>` and both
 * implementations honour it — `UnconfiguredVideoProvider` returns `'false'`,
 * `LiveKitVideoProvider` returns `'true'`, each with a comment on the PHP side saying why
 * neither may quietly become a real boolean.
 *
 * `Boolean('false')` is `true`. So the most natural line anybody could write here —
 * `configured: Boolean(credentials.configured)` — puts a clinician into a dead room for
 * every clinic that has not deployed a media server, which is all of them until one is
 * deployed, and it does it while the types still check.
 *
 * That comparison used to live inline in `api/room.ts`, in a module that imports
 * `next/headers` and therefore cannot be loaded by the unit runner at all. The trap was
 * documented in three places and asserted in none. It is one exported function now, and
 * `media.test.ts` drives the exact value that springs it.
 *
 * ====================================================================================
 * WHAT THE PROVIDER IS EVER TOLD, RESTATED ON THIS SIDE OF THE WIRE
 * ====================================================================================
 *
 * A room name (`apt-{ulid}`, opaque) and a participant LABEL — the role, never the person.
 * The backend enforces that list in `LiveKitVideoProvider::PARTICIPANT_LABELS` and throws
 * rather than substituting, because a participant identity is broadcast to every other
 * participant and is written into the media server's own operational logs — which, now that
 * we self-host, sit on a VPS outside the tenant database and outside row-level security.
 * `asParticipant()` is this side's copy of that closed list, so a screen saying "you are
 * joined as …" renders one of two known words rather than whatever arrived in a cookie.
 *
 * @see backend/app/Support/Video/LiveKitVideoProvider.php
 * @see docs/70-decisions/0004-video-provider-selection.md
 */

/**
 * The only value that means "a media server is configured for this clinic".
 *
 * Named rather than inlined so the literal and the comparison cannot drift apart, and so a
 * grep for it finds every place the decision is taken.
 */
export const CONFIGURED = 'true'

/**
 * Read the platform's `configured` flag off the redeem response.
 *
 * STRICT EQUALITY AGAINST THE STRING, AND NOTHING ELSE IS TRUE. Not `'TRUE'`, not `'1'`,
 * not the boolean `true`. The rule is deliberately harsh in the direction of the honest
 * fallback: every value this function does not recognise resolves to "no media server",
 * which tells the clinician plainly to hold the consultation the way the clinic already
 * does. The opposite default draws a pane with nothing in it and no explanation, which is
 * the frozen frame the whole degradation design exists to prevent.
 *
 * A real boolean `true` therefore reads as NOT configured, intentionally: it can only arrive
 * if somebody changed the PHP contract, and failing closed surfaces that on a developer's
 * screen rather than in a consulting room.
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
 * Null rather than a fallback to `'clinician'`: mislabelling which side of a consultation
 * somebody is on is not a thing to paper over with a default, and the screen omits the line
 * when it cannot be established.
 */
export function asParticipant(value: unknown): ParticipantLabel | null {
  return typeof value === 'string' && (PARTICIPANT_LABELS as readonly string[]).includes(value)
    ? (value as ParticipantLabel)
    : null
}

/**
 * What the media pane should draw, decided in one place.
 *
 *   unconfigured  no media server for this clinic. Say so, and say what to do instead.
 *                 `UnconfiguredVideoProvider` exists on the backend to keep this a WORKING
 *                 state rather than an error one.
 *   no-client     a media server IS configured and brokered a session, and there is no
 *                 address or credential here to open it with.
 *   ready         a session was brokered and both halves of it are in hand. The SDK opens
 *                 the room. See LiveKitStage.
 *
 * `ready` IS NEW AND `no-client` DID NOT GO WITH IT, WHICH IS THE PART WORTH READING.
 *
 * The obvious change when the SDK landed was to collapse this to two members — configured
 * means ready — and it would have been wrong for a reason that only shows up on a deploy.
 * The entry is remembered in a cookie for ninety minutes. A clinician who entered the room
 * on the PREVIOUS build is holding a cookie that says `configured: true` and carries no
 * `url` and no `token`, because the previous build deliberately did not store them. Ninety
 * minutes of consultations would have met a client asked to connect to `undefined`, which
 * presents as a pane sitting on "connecting" forever — the exact frozen frame the whole
 * degradation design exists to prevent, arriving by a new road.
 *
 * So `no-client` survives as what it always was: a session was brokered and this page cannot
 * open it. It is now reachable by a stale cookie rather than by a missing dependency, and
 * both resolve the same way — press the door button again, which mints a fresh credential.
 *
 * A CLOSED UNION AND NOT A STRING, WHICH IS A CHANGE AND IS THE POINT OF THE CHANGE.
 *
 * `ready` is the only member that has anything to hand a caller, and it has to hand over two
 * values that are `string | null` everywhere upstream. As a bare string this type could say
 * "ready" and the compiler would still make the pane re-test both fields before it could
 * pass them on — so the condition would live in two places, and the second copy is the one
 * that drifts. Carrying the pair inside the member instead means a screen cannot render
 * half-initialised, because the compiler will not let it read a field the state does not
 * have. `RoomState` in ../api/entry.ts is the same shape for the same reason.
 */
export type MediaState =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'no-client' }
  | { readonly kind: 'ready'; readonly url: string; readonly token: string }

/**
 * @param configured Already coerced by `isMediaConfigured` upstream, in `api/room.ts`, which
 *                   is the only place the wire value is read.
 * @param url The media server's address, or null when the entry carries none.
 * @param token The media credential, or null when the entry carries none.
 */
export function mediaState(
  configured: boolean,
  url: string | null,
  token: string | null,
): MediaState {
  if (!configured) {
    return { kind: 'unconfigured' }
  }

  /*
   * BOTH, NOT EITHER. A URL with no token cannot authenticate and a token with no URL has
   * nowhere to go, so "half configured" is not a state worth having: it is `no-client`,
   * exactly as if neither had arrived, and it takes the same honest screen.
   */
  if (url === null || token === null) {
    return { kind: 'no-client' }
  }

  return { kind: 'ready', url, token }
}
