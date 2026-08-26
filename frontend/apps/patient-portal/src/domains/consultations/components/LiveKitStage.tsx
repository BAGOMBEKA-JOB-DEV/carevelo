'use client'

import { useCallback, useContext, useEffect, useState } from 'react'
import { ConnectionState, Room, RoomEvent, Track, VideoPresets, type RoomOptions } from 'livekit-client'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  RoomContext,
  VideoTrack,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
  type TrackReference,
} from '@livekit/components-react'
import { Button, Notice, Stack } from '@carevelo/ui'

/**
 * ====================================================================================
 * THE MEDIA CLIENT. THE ONLY MODULE IN THIS PRODUCT THAT OPENS A WEBRTC SESSION.
 * ====================================================================================
 *
 * Reached only from `VideoStage`'s `ready` branch, which means a media server is configured
 * AND an address and a credential are both in hand. Everything else — the unconfigured
 * clinic, the stale cookie — was decided before this file is imported, and each of those
 * has its own honest screen that does not involve a spinner.
 *
 * ====================================================================================
 * WHAT `'use client'` COSTS HERE, AND WHAT WAS DONE ABOUT IT
 * ====================================================================================
 *
 * THE DIRECTIVE DRAGS THIS MODULE'S WHOLE IMPORT GRAPH INTO THE BROWSER BUNDLE. That is
 * the rule the console's domain barrel learned the hard way — a sign-out button in the
 * identity domain imported a barrel and pulled the entire consultation room in with it —
 * and it is worth more here than anywhere else in the product, because the thing on the
 * other end of these imports is a WebRTC SDK and this app has a 150KB first-load budget
 * defended for a patient on a mid-range Android on mobile data.
 *
 * So the imports above are exactly four things and no barrel: the SDK, the React hooks
 * that drive it, three UI primitives, and React. IN PARTICULAR:
 *
 *   - NOT `../api/room`. It imports `next/headers`, which cannot exist in a browser. The
 *     props below are primitives for that reason — `url` and `token` as bare strings —
 *     rather than the `RoomCredentials` object the server already has in its hand.
 *   - NOT `../index`. The domain barrel pulls in the room, the entry flow and the gateway.
 *   - NOT `next-intl`. This app deliberately mounts no `NextIntlClientProvider` (see
 *     `SiteShell`), so every sentence is translated on the SERVER and handed down as
 *     `copy`. That is the same shape `ChatComposer` uses and it keeps the catalogue out of
 *     the bundle.
 *
 * THE BUDGET IS NOT SPENT ON THE ROUTE THAT HAS ONE. This module is reached from
 * `/consultations/[appointment]` and from nowhere else, so the SDK lands in that route's
 * own chunk. The landing page and the booking path — which is what the 150KB is written
 * against — do not import it and do not pay for it.
 *
 * ====================================================================================
 * AUDIO FIRST, AND THAT IS A CLINICAL DECISION BEFORE IT IS A NETWORK ONE
 * ====================================================================================
 *
 * THE CAMERA IS OFF WHEN THE PATIENT ARRIVES AND STAYS OFF UNTIL THEY PRESS SOMETHING.
 * Three reasons, in the order they matter:
 *
 *   1. A patient opening a consultation is often in bed, in a shared room, or in a shop
 *      with people behind them. A product that turns their camera on because a page loaded
 *      has published a picture of them nobody asked for, and on a REFRESH it does it again
 *      with no press at all.
 *   2. Voice is a first-class mode in this product, not a fallback. `ConsultationMode`
 *      carries `voice` and `chat` as real values, the clinician can step a consultation
 *      down into either, and the record says which was used. A pane that treats video as
 *      the real thing and voice as a degraded version of it contradicts the record.
 *   3. Video is roughly ten times the bitrate of audio. On the connection this product is
 *      designed for, starting a call with video is how the audio breaks up — and the audio
 *      is the consultation.
 *
 * So `connect()` publishes the microphone and nothing else, and there is a control to add
 * the camera and the SAME control removes it. Never a camera without a way to stop it.
 *
 * WHAT THE ROOM OPTIONS BELOW ARE FOR is written on each one. Together they are the
 * difference between a call that survives a bad minute and a call that ends in one.
 *
 * ====================================================================================
 * WHAT THIS FILE MUST NEVER GROW
 * ====================================================================================
 *
 * NO EGRESS, NO RECORDING. A standing non-goal in four documents, and the ABSENCE of a
 * media store is load-bearing in ADR-0004's residency argument. The grant we are handed
 * says `roomRecord: false`, so a client that asked would be refused — but the refusal is
 * not the point, the not asking is.
 *
 * NO LIVEKIT DATA CHANNEL, WHICH IS WHY THERE IS NO CHAT IN HERE. The SDK ships a chat
 * component and it would be four lines. In-consultation chat is CLINICAL DATA: it belongs
 * in the tenant database under row-level security and in the patient's record, and it has
 * a panel on this page already that puts it there. A data-channel chat would be a second
 * path for the same text that leaves no record in the patient's file at all. The grant
 * says `canPublishData: false` for exactly this reason, so the SDK's chat could not send
 * anything even if somebody imported it.
 *
 * NO PARTICIPANT NAME, EVER. `sub` in the token is the string 'patient' or 'clinician',
 * and LiveKit broadcasts a participant's identity to everyone else in the room and writes
 * it into its own operational logs — which sit on a VPS outside the tenant database and
 * outside RLS. The labels rendered below come from `copy`, which is this app's own words
 * for the two roles, and are never read off the participant.
 *
 * @see backend/app/Support/Video/LiveKitAccessToken.php — the grant, written out in full
 * @see deploy/livekit/README.md — the network under this, and what breaks without TURN
 */

/** Every sentence this pane can say, translated on the server and handed down. */
export type StageCopy = {
  readonly connecting: string
  readonly live: string
  readonly reconnecting: string
  readonly closed: string
  readonly failedTitle: string
  readonly failedBody: string
  readonly micOn: string
  readonly micOff: string
  readonly micBlockedTitle: string
  readonly micBlockedBody: string
  readonly cameraOn: string
  readonly cameraOff: string
  readonly cameraIsOff: string
  readonly waiting: string
  readonly you: string
  readonly them: string
  readonly soundBlocked: string
  readonly enableSound: string
  readonly dataNote: string
}

/**
 * How this client behaves on a bad network. A module constant, not a value built per render:
 * `LiveKitRoom` constructs its `Room` from this once, and a fresh object each render would
 * invite it to be reconstructed.
 *
 * EVERY OPTION HERE IS A DECISION ABOUT UGANDAN MOBILE DATA. This is the tuning ADR-0004 said
 * would become ours the moment we self-hosted, and it is the part a managed provider would
 * have had specialists for.
 */
const ROOM_OPTIONS: RoomOptions = {
  /*
   * The SFU stops sending a video track whose element is not on screen, and drops to a
   * smaller layer for one that is small. On a metered connection this is the difference
   * between paying for a picture somebody is looking at and paying for one that is scrolled
   * off under the chat panel.
   */
  adaptiveStream: true,

  /*
   * And the other direction: stop PUBLISHING a quality layer nobody is subscribed to. With
   * two participants and one of them looking at a small tile, the large layer is uplink spent
   * on nothing — and uplink is the scarce half of a mobile connection.
   */
  dynacast: true,

  videoCaptureDefaults: {
    /*
     * 360p, not 720p. A consultation is a head and shoulders in a card that is at most a few
     * hundred pixels wide on the device this is designed for, and 720p costs about four times
     * the bitrate to deliver detail that is thrown away in the scale-down. It is also what a
     * mid-range Android's front camera can encode without heating up and throttling half way
     * through the encounter.
     */
    resolution: VideoPresets.h360.resolution,
  },

  audioCaptureDefaults: {
    // A consultation is held in a clinic corridor, or a room with a television on.
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },

  publishDefaults: {
    /*
     * Two layers and the lower one is 180p. The default set starts higher; on a connection
     * that cannot carry 360p the useful question is whether there is a layer that fits, and
     * 180p is a picture where the alternative is none.
     */
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    simulcast: true,

    /*
     * VP8 rather than letting the SDK pick. It is the codec every browser on every handset in
     * this market decodes in hardware; the newer ones fall back to software on cheap devices,
     * which burns battery and drops frames.
     */
    videoCodec: 'vp8',

    /*
     * THE TWO AUDIO OPTIONS ARE THE ONES THAT ACTUALLY MATTER HERE.
     *
     * `dtx` stops sending packets during silence, which in a consultation — where one person
     * listens while the other talks — is most of the call, and it is the cheapest bandwidth
     * saving available.
     *
     * `red` sends each audio packet redundantly. It costs a little uplink and buys
     * intelligibility across the packet loss that mobile data produces constantly. On a call
     * whose content is a dose and a frequency, a word lost to a dropped packet is the one
     * thing this pane must spend bandwidth to prevent.
     */
    dtx: true,
    red: true,

    /*
     * When the connection degrades, sacrifice FRAME RATE and keep the resolution. A
     * consultation is a nearly still picture of a face, and the thing actually held up to the
     * camera — a medicine box, a referral slip, a rash — stays legible at eight frames a
     * second and does not at 320x240.
     */
    degradationPreference: 'maintain-resolution',
  },
}

export function LiveKitStage({
  url,
  token,
  copy,
}: {
  /** The SFU's signalling address. A bare string, not `RoomCredentials` — see the header. */
  url: string
  /** The media credential. Reaches this browser as an RSC prop, never via `document.cookie`. */
  token: string
  copy: StageCopy
}) {
  /*
   * Whether the connection could not be established, as opposed to having dropped. The SDK's
   * `ConnectionState` has no terminal "never got there" member — a failed connect leaves it
   * `Disconnected`, which is also what a clean hang-up leaves — and the two need different
   * sentences, so the distinction is kept here.
   */
  const [failed, setFailed] = useState(false)

  /** The browser refused the microphone. The consultation is not over; the chat still works. */
  const [micBlocked, setMicBlocked] = useState(false)

  return (
    /*
     * ================================================================================
     * THE SDK'S OWN ROOM COMPONENT, AND IT REPLACED A HAND-ROLLED `useEffect`
     * ================================================================================
     *
     * The first version of this file built the `Room` in a lazy `useState` and drove
     * `connect()` / `disconnect()` from an effect. It looked right, it type-checked, and it
     * was broken in a way only a real two-party call revealed: React runs effects twice, the
     * cleanup's `disconnect()` raced the in-flight `connect()` on the SAME room instance, and
     * the SFU log showed both participants joining `RM_…` and then
     *
     *     skipping incoming track after Room disconnected
     *
     * repeatedly — a room whose signalling had connected while its own state said
     * disconnected. Neither side ever rendered a tile. That is precisely the shape of failure
     * this product cannot ship: nothing threw, nothing logged an error, and the pane simply
     * sat there.
     *
     * `LiveKitRoom` owns that lifecycle, and owning it is the library's job rather than
     * ours. It creates the room from `options`, connects, publishes, and tears down in the
     * right order across remounts.
     *
     * `audio` AND `video={false}` ARE THE AUDIO-FIRST RULE, EXPRESSED WHERE IT CANNOT BE
     * MISSED. The microphone is published on connect because that is the consultation; the
     * camera is not, and the only thing that turns it on is a person pressing the control
     * below. Written this way it is one prop rather than an omission somebody later "fixes".
     */
    <LiveKitRoom
      serverUrl={url}
      token={token}
      options={ROOM_OPTIONS}
      connect
      audio
      video={false}
      className="media-stage"
      /*
       * A CONNECT THAT NEVER LANDED. The error object is deliberately not read: the SDK's
       * message names the SFU's host and can carry the token, and this is a page rendering
       * health data. What the patient needs is what to do next, which is on the screen.
       */
      onError={() => setFailed(true)}
      /* A later success clears it, so a reconnect that works stops saying it failed. */
      onConnected={() => setFailed(false)}
      /*
       * A REFUSED MICROPHONE IS A STATE ON A WORKING CONNECTION, NOT A FAILED ONE. A patient
       * who declines the permission prompt is still IN the room: they can hear the clinician,
       * see them if a camera goes on, and type. Only the audio input is narrowed on, so a
       * camera failure — which is the patient's own choice most of the time — says nothing.
       */
      onMediaDeviceFailure={(_failure, kind) => {
        if (kind === 'audioinput') {
          setMicBlocked(true)
        }
      }}
    >
      {/*
       * REMOTE AUDIO IS RENDERED BY THE SDK AND NOT BY HAND. It attaches every subscribed
       * audio track to its own element and detaches on unsubscribe. Written by hand this is
       * the code that leaves a detached <audio> playing after a participant leaves, which on
       * this screen is a voice in a consultation that has ended.
       */}
      <RoomAudioRenderer />

      <StageBody copy={copy} failed={failed} micBlocked={micBlocked} />
    </LiveKitRoom>
  )
}

/**
 * Everything that needs to read the room, which is everything that needs to be inside the
 * provider above.
 *
 * A separate component rather than a fragment, because the SDK's hooks resolve their room
 * from context and a hook called in the same component that renders the provider would read
 * the context ABOVE it — which is undefined, and presents as a pane that never updates.
 */
function StageBody({
  copy,
  failed,
  micBlocked,
}: {
  copy: StageCopy
  failed: boolean
  micBlocked: boolean
}) {
  const room = useContextRoom()
  const state = useConnectionState(room)
  const remotes = useRemoteParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()

  /*
   * Camera tracks only. Microphone tracks are handled by `RoomAudioRenderer` above and must
   * not also be rendered here, or the far end's voice plays twice.
   *
   * `onlySubscribed` because an unsubscribed publication has no media behind it yet, and a
   * tile bound to one is a permanently black rectangle.
   */
  const cameras = useTracks([Track.Source.Camera], { onlySubscribed: true })
  const mine = cameras.find((track) => track.participant.isLocal)
  const theirs = cameras.find((track) => !track.participant.isLocal)

  /*
   * WHETHER THE BROWSER WILL ACTUALLY PLAY THE SOUND, WHICH IS NOT THE SAME QUESTION AS
   * WHETHER IT ARRIVED.
   *
   * Autoplay policy blocks audio on a page the person has not interacted with, and the
   * failure is completely silent: the track is subscribed, the connection is healthy, the
   * SDK is happy, and the patient hears nothing and concludes the call is broken. The SDK
   * exposes the state and a method to clear it — which must be called from a real gesture,
   * hence a button rather than an effect.
   */
  const [soundBlocked, setSoundBlocked] = useState(false)

  useEffect(() => {
    const sync = () => setSoundBlocked(!room.canPlaybackAudio)

    sync()
    room.on(RoomEvent.AudioPlaybackStatusChanged, sync)

    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, sync)
    }
  }, [room])

  const startSound = useCallback(() => {
    void room.startAudio()
  }, [room])

  const toggleMic = useCallback(() => {
    void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {
      /* A refusal is already visible: the button does not change state. */
    })
  }, [localParticipant, isMicrophoneEnabled])

  const toggleCamera = useCallback(() => {
    void localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => {
      /* Same: the control simply does not latch, and the consultation carries on. */
    })
  }, [localParticipant, isCameraEnabled])

  if (failed) {
    /*
     * A `warn` rather than a `bad`, for the reason the whole pane exists: the patient is IN
     * a working consultation. The picture failed; the messages below did not, and the
     * clinician is reachable. The loudest colour in the product would be a claim that
     * everything has stopped.
     */
    return (
      <Notice tone="warn" icon="help" title={copy.failedTitle} announce={false}>
        <p>{copy.failedBody}</p>
      </Notice>
    )
  }

  return (
    <>
      <p className="media-status">
        {/* The dot is decoration and the word is the message — a dot alone says nothing to
            a screen reader and less to a colour-blind patient. */}
        <span className={`media-dot ${dotClass(state)}`} aria-hidden="true" />
        <span>{stateLabel(state, copy)}</span>
      </p>

      {soundBlocked ? (
        <Notice tone="info" icon="phone" title={copy.soundBlocked} announce={false}>
          <Stack gap="4">
            <p>{copy.dataNote}</p>
            <div>
              <Button variant="brand" onClick={startSound}>
                {copy.enableSound}
              </Button>
            </div>
          </Stack>
        </Notice>
      ) : null}

      {micBlocked ? (
        <Notice tone="warn" icon="help" title={copy.micBlockedTitle} announce={false}>
          <p>{copy.micBlockedBody}</p>
        </Notice>
      ) : null}

      {/* `--pair` only once there are two people to lay out. One tile in a two-column grid
          is a tile at half width beside a hole. */}
      <div className={`media-grid${remotes.length > 0 ? ' media-grid--pair' : ''}`}>
        <Tile
          label={copy.them}
          quiet={remotes.length === 0 ? copy.waiting : copy.cameraIsOff}
          track={theirs}
          mirrored={false}
        />
        <Tile label={copy.you} quiet={copy.cameraIsOff} track={mine} mirrored />
      </div>

      <div className="media-controls">
        {/*
         * `aria-pressed` rather than two different labels, so a screen reader announces the
         * control's STATE rather than requiring the listener to infer it from a verb. The
         * visible label still changes, because a sighted user reads the label and not the
         * attribute.
         */}
        <Button variant="quiet" onClick={toggleMic} aria-pressed={isMicrophoneEnabled}>
          {isMicrophoneEnabled ? copy.micOff : copy.micOn}
        </Button>

        <Button variant="quiet" onClick={toggleCamera} aria-pressed={isCameraEnabled}>
          {isCameraEnabled ? copy.cameraOff : copy.cameraOn}
        </Button>
      </div>
    </>
  )
}

/**
 * One seat.
 *
 * `track` is optional and its absence is the ORDINARY case rather than an error: the camera
 * is off by default on both sides, so a voice consultation renders two of these with no
 * video in either for its whole length. Hence a sentence and not a spinner.
 */
function Tile({
  label,
  quiet,
  track,
  mirrored,
}: {
  label: string
  quiet: string
  /*
   * `TrackReference` and not the placeholder union. `useTracks` returns placeholders — a seat
   * with no media behind it yet — only when it is asked for sources WITH options; asked for a
   * bare source list, as it is above, every element has a real publication. `VideoTrack`
   * requires that, correctly: a placeholder has nothing to attach to an element.
   */
  track: TrackReference | undefined
  mirrored: boolean
}) {
  return (
    <div className="media-tile">
      <div className="media-tile__frame">
        {track ? (
          <VideoTrack
            trackRef={track}
            className={`media-tile__video${mirrored ? ' media-tile__video--mirrored' : ''}`}
          />
        ) : (
          <p className="media-tile__quiet">{quiet}</p>
        )}
      </div>
      <span className="media-tile__label">{label}</span>
    </div>
  )
}

/**
 * The room out of the SDK's context.
 *
 * NARROWED WITH A THROW RATHER THAN A `!`. `RoomContext` is typed `Room | undefined`
 * because the SDK cannot know whether a caller mounted a provider; this file does know,
 * because the only component that renders `StageBody` is the one that renders the provider
 * around it. The throw states that structural fact in a form the compiler accepts and a
 * future refactor would trip over, where a non-null assertion would silently produce
 * `undefined.on(...)` at the first hook call.
 */
function useContextRoom(): Room {
  const room = useContext(RoomContext)

  if (room === undefined) {
    throw new Error('LiveKitStage rendered outside its own RoomContext.Provider')
  }

  return room
}

/** Which of four sentences the status line says. */
function stateLabel(state: ConnectionState, copy: StageCopy): string {
  switch (state) {
    case ConnectionState.Connected:
      return copy.live
    case ConnectionState.Reconnecting:
      return copy.reconnecting
    case ConnectionState.Connecting:
      return copy.connecting
    default:
      return copy.closed
  }
}

function dotClass(state: ConnectionState): string {
  switch (state) {
    case ConnectionState.Connected:
      return 'media-dot--live'
    case ConnectionState.Reconnecting:
    case ConnectionState.Connecting:
      return 'media-dot--wait'
    default:
      return 'media-dot--dead'
  }
}
