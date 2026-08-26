import { cookies } from 'next/headers'
import { ApiError, type operations } from '@carevelo/api-client'
import { isMediaConfigured } from '../model/media'
import { writingApi } from './gateway'

/**
 * Getting into the room: issue a pass, spend it, remember the result.
 *
 * THE TOKEN NEVER APPEARS IN A URL. It is issued by a POST, it travels back up in the
 * BODY of the redeem call, and it is never written to a query string, a path segment or a
 * link. That is not our preference, it is the reason the API is shaped as two calls: a
 * secret in a URL is written to the web server's access log, kept in the browser's
 * history, and handed to whatever the page links to next in the Referer header. None of
 * those are places a credential that opens a consultation may sit.
 *
 * WHY THE RESULT IS REMEMBERED IN A COOKIE. A join token is SINGLE-USE. If entering the
 * room were a GET — a link, a page load — then a refresh, a back button or the router
 * prefetching the link would each spend a token, and the patient would be locked out by
 * their own browser. So entering is a form POST that spends exactly one token, and what
 * comes back is kept in an HTTP-only cookie for as long as the consultation could
 * plausibly still be running. Reloading the room re-reads the cookie and spends nothing.
 *
 * AND WHEN THE COOKIE IS GONE, THE WAY BACK IS THE SAME LINK. Issuing is not limited; it
 * is spending that is. So a dropped call, a closed tab or a flat battery all resolve the
 * same way — open the join link again and press the button — which is exactly the "resume
 * link" the dropped-call exception path asks for, with no second URL to send anybody and
 * nothing to install.
 *
 * @see docs/30-architecture/realtime-and-video.md — session brokering
 * @see backend/app/Http/Controllers/Api/V1/JoinTokenController.php
 */

/** The issue response, taken from the contract rather than described a second time. */
type IssuedToken =
  operations['v1.appointments.join-token']['responses'][201]['content']['application/json']

/**
 * The redeem response.
 *
 * `data` is typed in the contract as an open `{ [key: string]: string }`, and that is
 * correct rather than lazy: the keys are the PROVIDER's, and which provider is in use is
 * ADR-0004's open decision. What the platform guarantees regardless is the pair below —
 * `provider` and `configured` — which is what a client branches on. Everything else in
 * the map belongs to whichever media SDK eventually reads it.
 */
type RedeemedCredentials =
  operations['v1.consultations.join.redeem']['responses'][200]['content']['application/json']

/**
 * What the portal remembers about an entry. NOT a contract type.
 *
 * IT NOW CARRIES THE PROVIDER'S OWN TWO KEYS, which is the change, and the reason they were
 * kept out until now has been answered rather than overruled. The old note said a credential
 * admitting its holder to a named patient's consultation, sitting in a cookie for ninety
 * minutes "with nothing able to spend it", was exposure bought for nothing. That was right:
 * the cost was real and the benefit was zero. There is a client in this build now, so the
 * benefit is the consultation itself, and the cost is the same cost every session cookie on
 * this portal already carries.
 *
 * WHAT KEEPS THAT DEFENSIBLE IS THE THREE THINGS THE COOKIE ALREADY DID:
 *
 *   httpOnly     no script on this page can read it, which matters more now than it did
 *                when it held nothing. The token reaches the browser as a PROP on a client
 *                component — serialised into the RSC payload by a server component that
 *                read the cookie — and never through `document.cookie`.
 *   sameSite     it does not travel to another origin's request.
 *   the room     the grant inside the token is scoped to ONE room and cannot join another.
 *                See `LiveKitAccessToken` — `video.room` is the whole of its authority, and
 *                `roomAdmin`, `roomList`, `roomRecord` and `canPublishData` are all false.
 *
 * BOTH ARE NULLABLE, AND NULL IS A REAL STATE RATHER THAN A DEFENSIVE ONE. An unconfigured
 * clinic's redeem response carries neither key, so an entry brokered by
 * `UnconfiguredVideoProvider` stores null for both and the pane takes the honest branch. So
 * does an entry remembered by the build BEFORE this one, which is why `mediaState` still has
 * a `no-client` member — see ../model/media.ts.
 *
 * @see backend/app/Support/Video/LiveKitAccessToken.php — the grant, written out in full
 */
export interface RoomCredentials {
  readonly appointmentId: string
  /** Opaque, `apt-{ulid}`. Reveals nothing about the patient or the reason for the visit. */
  readonly room: string
  /** A ROLE — 'patient' or 'clinician' — never a person. */
  readonly participant: string
  /** Which provider brokered it. `unconfigured` when no media server is configured. */
  readonly provider: string
  /** False means: say so, rather than opening a dead room. */
  readonly configured: boolean
  /**
   * The media server's signalling address, `wss://…` in production.
   *
   * Null when no media server is configured. The media leg is browser <-> SFU and never
   * traverses the Laravel API, so this is the one moment the address is handed out.
   */
  readonly url: string | null
  /**
   * The media credential. A JWT, minted per participant per redemption.
   *
   * NOT THE SAME CREDENTIAL AS THE JOIN TOKEN AND NOT SUBJECT TO THE SAME RULE, which is
   * the distinction most likely to be got wrong here. The JOIN token is single-use and was
   * spent to obtain this. THIS one is a bearer credential with a lifetime — one hour, from
   * `video.livekit.token_ttl`, clamped by `LiveKitAccessToken` — and may be presented to
   * the SFU as many times as the connection needs, which is what lets a client reconnect
   * through a tunnel or a dropped 3G moment without a new round trip to this API.
   *
   * IT OUTLIVES NOTHING AND IS OUTLIVED BY THE COOKIE. `REMEMBER_SECONDS` is ninety
   * minutes and this is sixty, deliberately: the ROOM must stay open after the media
   * credential dies, because the note, the record and the chat are all still working and
   * throwing the patient back to the lobby would take those away too. The SDK's failed
   * connect is the authority on expiry, not this cookie, and the recovery is the door.
   */
  readonly token: string | null
}

const ROOM_COOKIE = 'carevelo_consultation_room'

/**
 * How long the portal remembers an entry.
 *
 * Not a credential lifetime — today's credentials hold no secret at all — but a guess at
 * how long a consultation might still be going. Long enough that a patient who reloads
 * forty minutes in is not sent back to the lobby, short enough that a shared handset does
 * not carry it into the evening. When a real provider's token lands in here it will have
 * its own, shorter expiry, and the media component will have to honour that rather than
 * this.
 */
const REMEMBER_SECONDS = 90 * 60

export type EntryResult =
  | { readonly ok: true }
  /** `message` is the API's own sentence where it has one. Never a raw payload. */
  | { readonly ok: false; readonly status: number; readonly message: string }

/**
 * Issue a pass for this appointment, spend it, and remember what came back.
 *
 * Two calls and not one, because that is what makes "single-use" a property rather than a
 * claim — see the controller's own note. Both write an audit event, which is the trail a
 * clinic needs when a patient says they were never let in.
 */
export async function enterRoom(appointmentId: string): Promise<EntryResult> {
  try {
    const api = await writingApi()

    // No Idempotency-Key, and that is deliberate. Issuing is not idempotent by design:
    // every call is meant to mint a fresh short-lived pass, and a key that made the API
    // replay the previous response would hand back a token that has already been spent.
    const issued = await api.post<IssuedToken>(
      `/v1/appointments/${encodeURIComponent(appointmentId)}/join-token`,
    )

    const redeemed = await api.post<RedeemedCredentials>('/v1/join-tokens/redeem', {
      // The BODY. See the header of this file.
      token: issued.data.token,
    })

    await remember(appointmentId, redeemed.data)

    return { ok: true }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, status: error.status, message: error.message }
    }

    throw error
  }
}

/**
 * What the portal remembers about this appointment's room, if anything.
 *
 * The appointment is checked against the stored one rather than assumed. A patient with
 * two bookings in one afternoon would otherwise open the second and be shown the first
 * one's room — and with a real provider that is a patient placed in a room they were not
 * admitted to.
 */
export async function readRoomCredentials(appointmentId: string): Promise<RoomCredentials | null> {
  const raw = (await cookies()).get(ROOM_COOKIE)?.value

  if (!raw) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    // A cookie we cannot read is a cookie we do not have. Not an error to show anybody:
    // the way out is the button that was going to be on the page anyway.
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const record = parsed as Record<string, unknown>
  const stored = string(record.appointmentId)

  if (stored === null || stored !== appointmentId) {
    return null
  }

  const room = string(record.room)
  const participant = string(record.participant)
  const provider = string(record.provider)

  if (room === null || participant === null || provider === null) {
    return null
  }

  return {
    appointmentId: stored,
    room,
    participant,
    provider,
    configured: record.configured === true,
    /*
     * READ BACK THROUGH THE SAME NARROWING AS EVERYTHING ELSE, so a cookie written by an
     * older build — which has neither key — comes back as null rather than as `undefined`
     * shaped like a string. `string()` rejects a non-string and an empty one alike, which
     * is what makes the `no-client` branch reachable instead of a client being handed an
     * address that is not one.
     */
    url: string(record.url),
    token: string(record.token),
  }
}

/**
 * Forget the entry. Leaving the room, not ending the consultation.
 *
 * Only the clinician ends a consultation, and only through the API. Clearing this cookie
 * closes the page; the encounter's record is untouched, which is why the button that
 * calls this says so in as many words.
 */
export async function forgetRoom(): Promise<void> {
  ;(await cookies()).delete(ROOM_COOKIE)
}

/**
 * Store the entry.
 *
 * HTTP-ONLY TODAY, WHEN IT HOLDS NOTHING SECRET, so that it is already right on the day
 * it does. The moment a provider is chosen this cookie carries a media credential, and a
 * flag nobody remembered to add is how that credential becomes readable by any script
 * with a foothold on a page rendering health data.
 *
 * `sameSite: 'lax'` matches the session cookie the whole portal already runs on, and is
 * what lets the entry survive the redirect the Server Action performs.
 */
async function remember(appointmentId: string, credentials: RedeemedCredentials['data']): Promise<void> {
  const value: RoomCredentials = {
    appointmentId,
    room: credentials.room ?? '',
    participant: credentials.participant ?? '',
    provider: credentials.provider ?? 'unknown',
    /*
     * A STRING ON THE WIRE, COMPARED AS ONE — and the comparison is now a named function in
     * ../model/media.ts rather than an inline `=== 'true'`.
     *
     * The backend sends 'false'/'true' because `VideoProvider::credentialsFor` is contracted
     * as `array<string, string>`. `Boolean('false')` is true, and that one line would open a
     * dead room on every unconfigured tenant. It was described in three comments and asserted
     * nowhere, because this module imports `next/headers` and cannot be loaded by the unit
     * runner — which is exactly why the decision moved to a module that can.
     */
    configured: isMediaConfigured(credentials.configured),

    /*
     * THE PROVIDER'S OWN TWO KEYS, and `?? null` rather than `?? ''`.
     *
     * The redeem response is typed as an open `{ [key: string]: string }` — the keys belong
     * to the provider — so both of these are `string | undefined` at this line, and an
     * unconfigured clinic sends neither. Empty string would be a value that LOOKS present:
     * `Boolean('')` is false today, but the pane's question is "is there an address", and
     * an empty one answers yes to any check that is not exactly right. Null answers no to
     * every one of them.
     */
    url: credentials.url ?? null,
    token: credentials.token ?? null,
  }

  ;(await cookies()).set({
    name: ROOM_COOKIE,
    value: JSON.stringify(value),
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: REMEMBER_SECONDS,
    // Left off in development, where the portal is plain http and a Secure cookie would
    // simply never be stored — which presents as "the button does nothing".
    secure: process.env.NODE_ENV === 'production',
  })
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
