import { Notice, Stack } from '@carevelo/ui'
import { asParticipant, type MediaState } from '../model/media'
import { MODE_LABEL, type ConsultationMode } from '../model/types'
import type { RoomCredentials } from '../api/room'
import { MediaClient } from './MediaClient'

/**
 * ====================================================================================
 * THE SEAM. THE LIVEKIT CLIENT SDK HAS LANDED IN IT.
 * ====================================================================================
 *
 * This file used to be a long note explaining, in three numbered steps, how to wire a media
 * client this build could not carry. All three are done — the credentials are stored
 * (`api/room.ts`), the client exists (`LiveKitStage.tsx`), and `MediaState` grew its `ready`
 * member — so the instructions are gone and what is left is the branch they described.
 *
 * IT IS REACHED ONLY WHEN A MEDIA SERVER IS CONFIGURED. `MediaPane` has already taken the
 * unconfigured branch, which is the honest fallback for every clinic that has not deployed an
 * SFU and is NOT a placeholder. So there are exactly two states here.
 *
 * ====================================================================================
 * WHY `no-client` SURVIVED THE SDK LANDING
 * ====================================================================================
 *
 * It looks like the obvious thing to delete: there IS a client now. It is reachable, and by
 * the least visible route there is — a deploy in the middle of a working afternoon.
 *
 * An entry is remembered in an HTTP-only cookie for ninety minutes. The build before this one
 * deliberately did not store `url` and `token`, so every clinician who entered a room under it
 * is holding a cookie that says `configured: true` and carries neither. For ninety minutes
 * after a deploy those consultations arrive here. Collapsing this to one branch would hand
 * each of them a client asked to connect to `undefined`, which does not throw and does not log
 * — it sits on "connecting" while a patient waits, which is the frozen frame the whole
 * degradation design exists to prevent, arriving by a new road.
 *
 * The recovery needs no new screen: leave the room and press the door button again. Issuing a
 * join token is not rate-limited — only SPENDING one is — so the door mints a fresh credential
 * every time it is used.
 *
 * ====================================================================================
 * THE SAME SENTENCE APPLIES TO AN EXPIRED CREDENTIAL, AND IT IS WHY THIS IS `warn`
 * ====================================================================================
 *
 * The cookie remembers an entry for ninety minutes; the media credential is minted for one
 * hour. The cookie outlives the token ON PURPOSE — the note, the prescribing, the record and
 * the messages must keep working after the picture dies, and throwing a clinician back to the
 * door mid-encounter to save them from a dead video leg would take the working half away too.
 * So the SDK's failed connect is the authority on expiry, `LiveKitStage` renders that as its
 * own notice, and both roads end at the same door.
 *
 * `warn`, not `bad`: a clinician who is IN a working consultation, writing a note and able to
 * message the patient, should not be shown the product's loudest failure colour because one
 * leg of it is missing — least of all on the screen where they decide whether to abandon.
 *
 * @see backend/app/Support/Video/LiveKitVideoProvider.php
 * @see deploy/livekit/README.md — what running this ourselves actually costs
 */
export function VideoStage({
  credentials,
  mode,
  state,
}: {
  credentials: RoomCredentials
  /** What the consultation is actually being held in, per the record. */
  mode: ConsultationMode | null
  /**
   * Decided by `MediaPane` and handed down NARROWED, which is the whole reason it is a prop.
   *
   * `unconfigured` is excluded at the type level rather than by a comment: that case has its
   * own screen one level up, and a component able to represent a state it must never draw is
   * a component that will eventually draw it.
   */
  state: Exclude<MediaState, { kind: 'unconfigured' }>
}) {
  if (state.kind === 'ready') {
    /*
     * THE ONLY TWO VALUES THAT CROSS INTO THE BROWSER, and they are both opaque.
     *
     * No patient name, no service, no appointment reference, no clinician identity — even
     * though this console has all four on the screen already. `LiveKitStage` is a
     * `'use client'` module, so everything handed to it is serialised into the RSC payload,
     * and the room name inside the token is `apt-{ulid}`, which reveals nothing about who is
     * in it or why.
     */
    return <MediaClient url={state.url} token={state.token} />
  }

  // `no-client`: a session was brokered and this entry carries nothing to open it with. See
  // the header — this is a stale cookie across a deploy, and the way out is the door.
  const participant = asParticipant(credentials.participant)

  return (
    <Notice tone="warn" icon="help" title="This room was opened before video was switched on" announce={false}>
      <Stack gap="3">
        <p>
          The clinic&rsquo;s server brokered a session, and the way into this room was opened
          too long ago to carry the credential that opens the picture. Leave the room and press
          the door button again — that mints a fresh one, and it changes nothing on the record.
        </p>
        <p>
          The consultation is not blocked meanwhile. Hold it{' '}
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
