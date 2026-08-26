import { Badge, Notice, Stack } from '@carevelo/ui'
import { asParticipant } from '../model/media'
import { MODE_LABEL, type ConsultationMode } from '../model/types'
import type { RoomCredentials } from '../api/room'

/**
 * ====================================================================================
 * THE SEAM. THIS IS THE ONE FILE THE LIVEKIT CLIENT SDK LANDS IN.
 * ====================================================================================
 *
 * Reached only when a media server IS configured for the clinic — `MediaPane` has already
 * taken the unconfigured branch, which is the honest fallback and is not a placeholder. So
 * everything here is about the state where the platform did its half and this build cannot
 * do its own.
 *
 * WHAT ACTUALLY LANDED ON THE BACKEND, so nobody has to go and check. ADR-0004 is Accepted
 * for LiveKit, SELF-HOSTED, chosen on cost — a Starter clinic's UGX 150,000/month has to
 * cover teleconsult, and 8,000 participant-minutes is $4 on LiveKit Cloud, $32 on Daily and
 * $120 on Twilio against a ~$40 subscription. `LiveKitVideoProvider` mints a JWT with
 * `LiveKitAccessToken` — by hand, over `hash_hmac`, no package — and the redeem response for
 * a configured clinic carries `url` (the `wss://` address of an SFU we run) and `token`
 * alongside the four fields the platform guarantees. There is no room-creation call: LiveKit
 * creates the room on the first participant to arrive holding a token that names it.
 *
 * WHAT DID NOT LAND, AND CANNOT HERE: `livekit-client`. This work may not add a dependency,
 * so there is no SDK in the bundle. THIS COMPONENT DOES NOT SHOW VIDEO AND DOES NOT PRETEND
 * TO.
 *
 * AND WHAT SELF-HOSTING COSTS, because a clinician reading this file after a failed call
 * deserves to know where to look. We now run the SFU and a TURN server — TURN is mandatory
 * rather than optional, because Ugandan mobile carriers are behind carrier-grade NAT and a
 * large share of patients cannot reach the SFU peer-to-peer at all. Nobody is on call.
 * `deploy/livekit/README.md` says all of it plainly, including what breaks when TURN is
 * missing, which presents as "video just doesn't work for some patients" and is almost
 * undiagnosable after the fact.
 *
 * ====================================================================================
 * WIRING IT, IN THREE STEPS AND IN THIS ORDER
 * ====================================================================================
 *
 *   1. `api/room.ts` — add `url` and `token` to `RoomCredentials`, set them in `remember()`
 *      from `credentials.url` / `credentials.token`, which the redeem response already
 *      carries, and read them back in `readRoomCredentials()` alongside `room`. They are
 *      deliberately not stored today: a credential that admits its holder to a named
 *      patient's consultation, sitting in a cookie with nothing able to spend it, is
 *      exposure bought for nothing.
 *
 *      NOTE THE LIFETIME MISMATCH WHEN YOU DO. The cookie remembers an entry for 90 minutes
 *      (`REMEMBER_SECONDS`); the media credential is minted for `video.livekit.token_ttl`,
 *      one hour by default and clamped by `LiveKitAccessToken`. The cookie outlives the
 *      token, so the SDK's failed connect — not this cookie — is the authority on expiry.
 *      The recovery already exists and needs no new screen: issuing a join token is not
 *      rate-limited, only spending one is, so pressing the door button again mints a fresh
 *      credential.
 *
 *   2. Add `./LiveKitStage.tsx`, `'use client'`, taking `{ url, token }` and nothing else.
 *      NO PATIENT NAME, NO SERVICE, NO CLINICIAN IDENTITY. A participant identity is
 *      broadcast to every other participant and written into the media server's own
 *      operational logs, which sit on a VPS outside the tenant database and outside
 *      row-level security. The backend enforces the same list in
 *      `LiveKitVideoProvider::PARTICIPANT_LABELS` and throws rather than substituting.
 *
 *      REMEMBER WHAT `'use client'` COSTS: the directive drags the module's whole import
 *      graph into the browser bundle. Import the SDK from that file and nothing else.
 *
 *   3. Return `<LiveKitStage …/>` from here, and add `'ready'` to `MediaState` in
 *      `../model/media.ts`. `media.test.ts` asserts today's two-state shape, so it fails
 *      until step 3 is done — which is the point of asserting it.
 *
 * NOTHING ELSE IN THIS DOMAIN MOVES. Not the door, not the entry flow, not the mode control,
 * not the note editor, not the chat panel, not the route.
 *
 * ====================================================================================
 * WHY THIS IS `warn` AND NOT `bad`, WHICH IS A CHANGE
 * ====================================================================================
 *
 * This branch used to be a red `tone="bad"` alarm. That was right while it was unreachable
 * — nobody would ever see it — and it is wrong now that a clinic can deploy an SFU and
 * reach it. A clinician who is IN a working consultation, able to read and write messages to
 * their patient and to write the note, should not be shown the product's loudest failure
 * colour because one leg is missing. It says what is true, in the order that matters: the
 * consultation is not blocked, here is what does work, and here is who to tell.
 */
export function VideoStage({
  credentials,
  mode,
}: {
  credentials: RoomCredentials
  /** What the consultation is actually being held in, per the record. */
  mode: ConsultationMode | null
}) {
  // There is no `ready` branch, because there is no `ready` state — see MediaState. When the
  // SDK lands this becomes a two-way branch and the type stops being a single word.
  const participant = asParticipant(credentials.participant)

  return (
    <Notice tone="warn" icon="help" title="This console has no video client in it yet" announce={false}>
      <Stack gap="3">
        <p>
          The clinic&rsquo;s server brokered a session with{' '}
          <Badge tone="info">{credentials.provider}</Badge> and this build carries no client
          able to open it. Tell whoever deployed this console: video was switched on after this
          version was built.
        </p>
        <p>
          The consultation is not blocked. Hold it{' '}
          {mode === null ? 'the way the clinic already does' : `by ${MODE_LABEL[mode].toLowerCase()}`}
          {' '}and record it here as you go — the note, the prescribing and the record all work,
          and so do the messages below, which the patient can see and answer.
        </p>
        {participant === null ? null : (
          <p className="fine">
            Room {credentials.room} · you are joined as {participant}. That pair is all a video
            service is ever told: a room name and a role, never a name and never a reason for
            the visit.
          </p>
        )}
      </Stack>
    </Notice>
  )
}
