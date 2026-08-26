import { getTranslations } from 'next-intl/server'
import { Notice, Stack } from '@carevelo/ui'
import { asParticipant, type MediaState } from '../model/media'
import type { RoomCredentials } from '../api/room'
import { MediaClient } from './MediaClient'

/**
 * ================================================================================
 * THE SEAM. THE LIVEKIT CLIENT SDK HAS LANDED IN IT.
 * ================================================================================
 *
 * This file used to be a long note explaining, in three numbered steps, how to wire a media
 * client that this build could not carry. All three are done — the credentials are stored
 * (`api/room.ts`), the client exists (`LiveKitStage.tsx`), and `MediaState` grew its `ready`
 * member — so the instructions are gone and what is left is the branch they described.
 *
 * IT IS REACHED ONLY WHEN A MEDIA SERVER IS CONFIGURED. `MediaPane` has already taken the
 * unconfigured branch, which is the honest fallback for every clinic that has not deployed an
 * SFU and is NOT a placeholder. So there are exactly two states here.
 *
 * ================================================================================
 * WHY `no-client` SURVIVED THE SDK LANDING
 * ================================================================================
 *
 * It looks like the obvious thing to delete: there IS a client now. It is reachable, and by
 * the least visible route there is — a deploy in the middle of a working afternoon.
 *
 * An entry is remembered in an HTTP-only cookie for ninety minutes. The build before this one
 * deliberately did not store `url` and `token`, so every patient who entered a room under it
 * is holding a cookie that says `configured: true` and carries neither. For ninety minutes
 * after a deploy those patients arrive here. Collapsing this to one branch would hand each of
 * them a client asked to connect to `undefined`, which does not throw and does not log — it
 * sits on "connecting" until they give up, which is the frozen frame the whole degradation
 * design exists to prevent, arriving by a new road.
 *
 * The recovery needs no new screen and no second URL: leave the room and open the same link
 * again. Issuing a join token is not rate-limited — only SPENDING one is — so the door mints
 * a fresh credential every time it is used. That is the same resume path the dropped-call
 * exception asks for, which is why this notice points at it rather than at support.
 *
 * ================================================================================
 * THE SAME SENTENCE APPLIES TO AN EXPIRED CREDENTIAL, AND IT IS WHY THIS BRANCH IS `warn`
 * ================================================================================
 *
 * The cookie remembers an entry for ninety minutes; the media credential is minted for one
 * hour. The cookie outlives the token ON PURPOSE — the note, the record and the messages must
 * keep working after the picture dies, and throwing a patient back to the lobby to save them
 * from a dead video leg would take the working half away too. So the SDK's failed connect is
 * the authority on expiry, `LiveKitStage` renders that as its own notice, and both roads end
 * at the same door.
 *
 * `warn`, not `bad`: a patient who is IN a working consultation, able to read and write
 * messages to their clinician, should not be shown the product's loudest failure colour
 * because one leg of it is missing.
 *
 * @see backend/app/Support/Video/LiveKitVideoProvider.php
 * @see deploy/livekit/README.md — what running this ourselves actually costs
 */
export async function VideoStage({
  clinic,
  phone,
  credentials,
  state,
}: {
  clinic: string
  phone?: string | undefined
  credentials: RoomCredentials
  /**
   * Decided by `MediaPane` and handed down NARROWED, which is the whole reason it is a prop.
   *
   * `unconfigured` is excluded at the type level rather than by a comment: that case has its
   * own screen one level up, and a component able to represent a state it must never draw is
   * a component that will eventually draw it.
   */
  state: Exclude<MediaState, { kind: 'unconfigured' }>
}) {
  const t = await getTranslations('Consultations')

  if (state.kind === 'ready') {
    /*
     * THE ONLY TWO VALUES THAT CROSS INTO THE BROWSER, and they are both opaque.
     *
     * No clinic name, no patient name, no service, no appointment reference, no clinician.
     * `LiveKitStage` is a `'use client'` module, so everything handed to it is serialised
     * into the RSC payload and is readable by anything with a foothold on this page — and
     * the room name inside the token is `apt-{ulid}`, which reveals nothing about who is in
     * it or why. The copy below is this app's own words, translated on the server, so the
     * message catalogue stays out of the bundle.
     */
    return (
      <MediaClient
        url={state.url}
        token={state.token}
        copy={{
          connecting: t('mediaConnecting'),
          live: t('mediaLive'),
          reconnecting: t('mediaReconnecting'),
          closed: t('mediaClosed'),
          failedTitle: t('mediaFailedTitle'),
          failedBody: t('mediaFailedBody', { clinic }),
          micOn: t('mediaMicOn'),
          micOff: t('mediaMicOff'),
          micBlockedTitle: t('mediaMicBlockedTitle'),
          micBlockedBody: t('mediaMicBlockedBody'),
          cameraOn: t('mediaCameraOn'),
          cameraOff: t('mediaCameraOff'),
          cameraIsOff: t('mediaCameraIsOff'),
          waiting: t('mediaWaiting'),
          you: t('mediaYou'),
          them: t('mediaThem'),
          soundBlocked: t('mediaSoundBlockedTitle'),
          enableSound: t('mediaEnableSound'),
          dataNote: t('mediaSoundBlockedBody'),
        }}
      />
    )
  }

  // `no-client`: a session was brokered and this entry carries nothing to open it with. See
  // the header — this is a stale cookie across a deploy, and the way out is the door.
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
