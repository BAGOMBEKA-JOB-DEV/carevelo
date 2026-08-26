import { getTranslations } from 'next-intl/server'
import { Notice, Stack } from '@carevelo/ui'
import { asParticipant } from '../model/media'
import type { RoomCredentials } from '../api/room'

/**
 * ================================================================================
 * THE SEAM. THIS IS THE ONE FILE THE LIVEKIT CLIENT SDK LANDS IN.
 * ================================================================================
 *
 * It is reached only when a media server IS configured for the clinic — `MediaPane` has
 * already taken the unconfigured branch, which is the honest fallback and is not a
 * placeholder. So everything below is about the state where the platform did its half and
 * this build cannot do its own.
 *
 * WHAT ACTUALLY LANDED ON THE BACKEND, so nobody has to go and check: ADR-0004 is Accepted
 * for LiveKit, SELF-HOSTED. `LiveKitVideoProvider` mints a JWT with `LiveKitAccessToken` —
 * by hand, over `hash_hmac`, no package — and the redeem response for a configured clinic
 * carries `url` (the `wss://` address of an SFU we run) and `token` alongside the four
 * fields the platform guarantees. There is no room-creation call: LiveKit creates the room
 * on the first participant to arrive holding a token that names it.
 *
 * WHAT DID NOT LAND, AND CANNOT HERE: `livekit-client`. This work may not add a dependency,
 * so there is no SDK in the bundle, and a browser cannot open a WebRTC session with an SFU
 * by wishing. THIS COMPONENT DOES NOT SHOW VIDEO AND DOES NOT PRETEND TO.
 *
 * ================================================================================
 * WIRING IT, IN THREE STEPS AND IN THIS ORDER
 * ================================================================================
 *
 *   1. `api/room.ts` — add `url` and `token` to `RoomCredentials`, and set them in
 *      `remember()` from `credentials.url` / `credentials.token`, which the redeem response
 *      already carries. Read them back in `readRoomCredentials()` alongside `room`. They are
 *      deliberately not stored today: a credential that admits its holder to a named
 *      patient's consultation, sitting in a cookie for ninety minutes with nothing able to
 *      spend it, is exposure bought for nothing.
 *
 *      NOTE THE LIFETIME MISMATCH WHEN YOU DO. The cookie remembers an entry for 90 minutes
 *      (`REMEMBER_SECONDS`); the media credential is minted for `video.livekit.token_ttl`,
 *      one hour by default and clamped by `LiveKitAccessToken`. So the cookie outlives the
 *      token, and the SDK's failed connect — not this cookie — is the authority on expiry.
 *      The recovery already exists and needs no new screen: issuing a join token is not
 *      rate-limited, only spending one is, so opening the same link again mints a fresh
 *      credential.
 *
 *   2. Add `./LiveKitStage.tsx`, `'use client'`, taking `{ url, token }` and nothing else.
 *      It must take NO patient name, NO service and NO clinician identity: a participant
 *      identity is broadcast to every other participant and written into the media server's
 *      own operational logs, which sit on a VPS outside the tenant database and outside
 *      row-level security. The backend enforces the same list in
 *      `LiveKitVideoProvider::PARTICIPANT_LABELS` and throws rather than substituting.
 *
 *      REMEMBER WHAT `'use client'` COSTS HERE: the directive drags the module's whole
 *      import graph into the browser bundle. Import the SDK from that file and nothing else,
 *      so the room's server-rendered half stays server-rendered.
 *
 *   3. Return `<LiveKitStage …/>` from the `ready` branch below, and add `'ready'` to
 *      `MediaState` in `../model/media.ts`. `media.test.ts` asserts today's two-state shape,
 *      so it fails until step 3 is done — which is the point of asserting it.
 *
 * NOTHING ELSE IN THIS DOMAIN MOVES. Not the lobby, not the entry flow, not the mode strip,
 * not the chat panel, not the route.
 *
 * ================================================================================
 * WHY THIS IS `warn` AND NOT `bad`, WHICH IS A CHANGE
 * ================================================================================
 *
 * This branch used to be a red `tone="bad"` alarm reading "This page cannot open the video
 * yet". That was right when it was unreachable — nobody would ever see it — and it is wrong
 * now that a clinic can deploy an SFU and reach it. A patient who is IN a working
 * consultation, able to read and write messages to their clinician, should not be shown the
 * product's loudest possible failure colour because one leg of it is missing.
 *
 * So it says what is true, in the order that matters to the person reading it: you are in
 * the room, there is no picture, here is what does work. The alternative — a grey rectangle
 * with a spinner — is the frozen frame the whole degradation design exists to prevent, and
 * it is worse than an honest sentence because it invites waiting.
 *
 * @see backend/app/Support/Video/LiveKitVideoProvider.php
 * @see deploy/livekit/README.md — what running this ourselves actually costs
 */
export async function VideoStage({
  clinic,
  phone,
  credentials,
}: {
  clinic: string
  phone?: string | undefined
  credentials: RoomCredentials
}) {
  const t = await getTranslations('Consultations')

  /*
   * There is no `ready` branch, because there is no `ready` state — see MediaState. When the
   * SDK lands this becomes a two-way branch and the type stops being a single word.
   */
  const participant = asParticipant(credentials.participant)

  return (
    <Notice tone="warn" icon="help" title={t('mediaNoClientTitle')} announce={false}>
      <Stack gap="3">
        <p>{t('mediaNoClientBody', { clinic })}</p>

        {/* THE POINT OF PAIRING THEM. Chat is served by this platform and does not touch the
            media stack — `ConsultationMessageController` reads no video configuration and
            mints no join token — so it is working right now, on this page, below this
            notice. Saying so is the difference between an outage and an inconvenience. */}
        <p>{t('mediaNoClientChat')}</p>

        <p>{phone ? t('callClinic', { clinic, phone }) : t('contactClinic', { clinic })}</p>

        {participant === null ? null : (
          <p className="fine">
            {t('mediaRoomFine', { room: credentials.room, participant: t(`participant.${participant}`) })}
          </p>
        )}
      </Stack>
    </Notice>
  )
}
