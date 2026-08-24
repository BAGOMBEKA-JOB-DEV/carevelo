import { cookies } from 'next/headers'
import { ApiError, type operations } from '@carevelo/api-client'
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
 * Deliberately narrowed to the four fields the platform guarantees plus the appointment they
 * belong to. The provider's own keys are not carried: nothing in this build can use them, and
 * a cookie is a poor place to keep a credential nobody reads. When a provider lands,
 * `MediaPane` is where its keys are consumed and this type widens to carry them.
 */
export interface RoomCredentials {
  readonly appointmentId: string
  /** Opaque, `apt-{ulid}`. Reveals nothing about the patient or the reason for the visit. */
  readonly room: string
  /** A ROLE — 'clinician' or 'patient' — never a person. It is the only label the provider ever learns. */
  readonly participant: string
  /** Which provider brokered it. `unconfigured` until ADR-0004 chooses one. */
  readonly provider: string
  /** False means: say so plainly, rather than opening a dead room. */
  readonly configured: boolean
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
     * A STRING ON THE WIRE, COMPARED AS ONE. The backend sends 'false'/'true' because
     * `VideoProvider::credentialsFor` is contracted as `array<string, string>`.
     * `Boolean('false')` is true, and that single coercion would open a dead room on every
     * unconfigured tenant — which is exactly the failure this flag exists to prevent.
     */
    configured: credentials.configured === 'true',
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
