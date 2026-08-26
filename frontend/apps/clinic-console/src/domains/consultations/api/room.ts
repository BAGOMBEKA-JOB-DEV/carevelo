import { cookies } from 'next/headers'
import { ApiError, type operations } from '@carevelo/api-client'
import { isMediaConfigured } from '../model/media'
import { writingApi } from './gateway'

/**
 * Getting the clinician into the room: issue a pass, spend it, remember the result.
 *
 * THE TOKEN NEVER APPEARS IN A URL. It is issued by a POST, it travels back up in the BODY of
 * the redeem call, and it is never written to a query string, a path segment or a link. That
 * is not a preference — it is the reason the API is two calls rather than one. A secret in a
 * URL is written to the web server's access log, kept in the browser's history, and handed to
 * whatever the page links to next in the `Referer` header. None of those are places a
 * credential that opens a consultation may sit.
 *
 * WHY THE RESULT IS REMEMBERED IN A COOKIE. A join token is SINGLE-USE — `redeem()` re-reads
 * it `FOR UPDATE` inside a transaction precisely so that two tabs cannot both be admitted. If
 * entering were a GET, then a refresh, a back button or the router prefetching a link would
 * each spend one, and the clinician would be locked out of their own consultation by their
 * own browser. So entering is a form POST that spends exactly one token, and what comes back
 * is kept in an HTTP-only cookie for as long as the encounter could plausibly still be
 * running. Reloading the room re-reads the cookie and spends nothing.
 *
 * AND WHEN THE COOKIE IS GONE, THE WAY BACK IS THE SAME BUTTON. Issuing is not limited; it is
 * spending that is. A dropped call, a closed tab and a flat battery all resolve the same way:
 * open the room and press the button. That is the resume path the dropped-call exception
 * asks for, with no second URL to send anybody and nothing to install.
 *
 * @see docs/30-architecture/realtime-and-video.md — session brokering
 * @see backend/app/Http/Controllers/Api/V1/JoinTokenController.php
 */

type IssuedToken =
  operations['v1.appointments.join-token']['responses'][201]['content']['application/json']

/**
 * The redeem response.
 *
 * `data` is typed in the contract as an open `{ [key: string]: string }`, and that is correct
 * rather than lazy: the keys belong to the PROVIDER, and which provider is in use is
 * ADR-0004's open decision. What the platform guarantees regardless is the pair this console
 * branches on — `provider` and `configured` — plus the room name and the participant's role.
 * Everything else in the map belongs to whichever media SDK eventually reads it.
 */
type RedeemedCredentials =
  operations['v1.consultations.join.redeem']['responses'][200]['content']['application/json']

/**
 * What the console remembers about an entry. NOT a contract type.
 *
 * IT NOW CARRIES THE PROVIDER'S OWN TWO KEYS, which is the change, and the reason they were
 * kept out until now has been answered rather than overruled. The old note said a credential
 * admitting its holder to a named patient's consultation, sitting in a cookie for ninety
 * minutes "with nothing able to spend it", was exposure bought for nothing. That was right:
 * the cost was real and the benefit was zero. There is a client in this build now, so the
 * benefit is the consultation itself, and the cost is the same one the session cookie this
 * console already runs on has always carried.
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
 * THIS MATTERS MORE ON A CLINIC TERMINAL THAN ON A PATIENT'S HANDSET, which is worth saying
 * where the decision is: a console is shared, and the cookie has always been the thing that
 * a sign-out has to remove. `forgetRoom()` is that removal and it now removes a real
 * credential rather than a description of one.
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
  /** A ROLE — 'clinician' or 'patient' — never a person. It is the only label the provider ever learns. */
  readonly participant: string
  /** Which provider brokered it. `unconfigured` when no media server is configured. */
  readonly provider: string
  /** False means: say so plainly, rather than opening a dead room. */
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
   * the distinction most likely to be got wrong here. The JOIN token is single-use —
   * `redeem()` re-reads it `FOR UPDATE` so two tabs cannot both be admitted — and was spent
   * to obtain this. THIS one is a bearer credential with a lifetime — one hour, from
   * `video.livekit.token_ttl`, clamped by `LiveKitAccessToken` — and may be presented to
   * the SFU as many times as the connection needs, which is what lets the pane reconnect
   * after a clinic's wifi drops without a fresh round trip to this API.
   *
   * IT OUTLIVES NOTHING AND IS OUTLIVED BY THE COOKIE. `REMEMBER_SECONDS` is ninety minutes
   * and this is sixty, deliberately: the ROOM must stay open after the media credential
   * dies, because the note, the prescribing and the record are all still working and
   * throwing the clinician back to the door would take those away mid-encounter. The SDK's
   * failed connect is the authority on expiry, not this cookie.
   */
  readonly token: string | null
}

const ROOM_COOKIE = 'carevelo_console_room'

/**
 * How long the console remembers an entry.
 *
 * Not a credential lifetime — today's credentials hold no secret at all — but a guess at how
 * long a consultation might still be running. Long enough that a clinician who reloads forty
 * minutes in is not sent back to the door; short enough that a shared clinic terminal does not
 * carry it into the evening. When a real provider's token lands here it will have its own,
 * shorter expiry, and the media component will have to honour that rather than this.
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
 * claim. Both write an audit event — `consultation.join_token_issued` and
 * `consultation.join_token_redeemed` — which is the trail a clinic needs when somebody says
 * they were never let in. Neither event carries anything but the participant's ROLE.
 *
 * NO IDEMPOTENCY KEY, DELIBERATELY. Issuing is not idempotent by design: every call mints a
 * fresh short-lived pass, and a key that made the API replay the previous response would hand
 * back a token that has already been spent.
 */
export async function enterRoom(appointmentId: string): Promise<EntryResult> {
  try {
    const api = await writingApi()

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
 * What the console remembers about this appointment's room, if anything.
 *
 * The appointment is checked against the stored one rather than assumed. A clinician with two
 * consultations in one afternoon would otherwise open the second and be handed the first
 * one's room — and with a real provider that is a clinician placed in a room they were not
 * admitted to, with a patient who is not theirs.
 */
export async function readRoomCredentials(
  appointmentId: string,
): Promise<RoomCredentials | null> {
  const raw = (await cookies()).get(ROOM_COOKIE)?.value

  if (!raw) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    // A cookie we cannot read is a cookie we do not have. Not an error to show anybody: the
    // way out is the button that was going to be on the page anyway.
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const record = parsed as Record<string, unknown>
  const stored = text(record.appointmentId)

  if (stored === null || stored !== appointmentId) {
    return null
  }

  const room = text(record.room)
  const participant = text(record.participant)
  const provider = text(record.provider)

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
     * shaped like a string. `text()` rejects a non-string and an empty one alike, which is
     * what makes the `no-client` branch reachable instead of a client being handed an
     * address that is not one.
     */
    url: text(record.url),
    token: text(record.token),
  }
}

/**
 * Forget the entry. LEAVING the room, not ending the consultation.
 *
 * The two are deliberately different acts with different buttons. Ending writes an outcome to
 * a clinical record and closes the appointment; this closes a page. A clinician who steps out
 * to fetch something comes back through the same door and spends one more token.
 */
export async function forgetRoom(): Promise<void> {
  ;(await cookies()).delete(ROOM_COOKIE)
}

/**
 * Store the entry.
 *
 * HTTP-ONLY TODAY, WHEN IT HOLDS NOTHING SECRET, so that it is already right on the day it
 * does. The moment a provider is chosen this cookie carries a media credential, and a flag
 * nobody remembered to add is how that credential becomes readable by any script with a
 * foothold on a page rendering health data.
 *
 * `sameSite: 'lax'` matches the session cookie the console already runs on, and is what lets
 * the entry survive the redirect a Server Action performs.
 */
async function remember(
  appointmentId: string,
  credentials: RedeemedCredentials['data'],
): Promise<void> {
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
     * as `array<string, string>`. `Boolean('false')` is true, and that single coercion would
     * open a dead room on every unconfigured tenant — the exact failure this flag exists to
     * prevent. It was described in three comments and asserted nowhere, because this module
     * imports `next/headers` and cannot be loaded by the unit runner. That is precisely why
     * the decision moved to a module that can.
     */
    configured: isMediaConfigured(credentials.configured),

    /*
     * THE PROVIDER'S OWN TWO KEYS, and `?? null` rather than `?? ''`.
     *
     * The redeem response is typed as an open `{ [key: string]: string }` — the keys belong
     * to the provider — so both of these are `string | undefined` at this line, and an
     * unconfigured clinic sends neither. Empty string would be a value that LOOKS present:
     * the pane's question is "is there an address", and an empty one answers yes to any
     * check that is not exactly right. Null answers no to every one of them.
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
    // Left off in development, where the console is plain http and a Secure cookie would
    // simply never be stored — which presents as "the button does nothing".
    secure: process.env.NODE_ENV === 'production',
  })
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
