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
 * THE MEDIA CLIENT. THE ONLY MODULE IN THIS CONSOLE THAT OPENS A WEBRTC SESSION.
 * ====================================================================================
 *
 * Reached only from `VideoStage`'s `ready` branch, which means a media server is configured
 * AND an address and a credential are both in hand. The unconfigured clinic and the stale
 * entry were both decided before this file is imported, and each has its own honest screen
 * that does not involve a spinner.
 *
 * THE PATIENT PORTAL HAS A NEAR-IDENTICAL FILE, AND THAT IS DELIBERATE RATHER THAN LAZY.
 * `apps/*` may not import one another — the boundary rules enforce it — and the two halves
 * of a consultation are not the same screen: the wording here is a clinician's ("The
 * patient", "Waiting for the patient to join"), the wording there is a patient's, and this
 * app carries no message catalogue while that one translates every sentence on the server.
 * The shared half is the CSS, which is why `.media-*` lives in `@carevelo/ui` and is written
 * once. Lifting this component into that package would put a WebRTC SDK into the dependency
 * graph of all four apps, including the two that will never open a room.
 *
 * ====================================================================================
 * WHAT `'use client'` COSTS HERE
 * ====================================================================================
 *
 * THE DIRECTIVE DRAGS THIS MODULE'S WHOLE IMPORT GRAPH INTO THE BROWSER BUNDLE. This domain
 * has already paid for learning that once: a sign-out button in the identity domain imported
 * this domain's barrel and pulled `ConsultationRoom` and the realtime gateway in with it,
 * and the build failed. `SignOutSubmit` lives in this folder for that reason.
 *
 * So the imports above are the SDK, its React hooks, three UI primitives and React. IN
 * PARTICULAR NOT `../api/room` — it imports `next/headers`, which cannot exist in a browser
 * — which is why the props below are bare strings rather than the `RoomCredentials` object
 * the server already holds. And not `../index`, which is the barrel that caused the failure.
 *
 * ====================================================================================
 * AUDIO FIRST, AND THAT IS A CLINICAL DECISION BEFORE IT IS A NETWORK ONE
 * ====================================================================================
 *
 * THE CAMERA IS OFF WHEN THE CLINICIAN ARRIVES AND STAYS OFF UNTIL THEY PRESS SOMETHING.
 * Ronald works between rooms on a phone. A console that publishes his camera because a page
 * loaded has put whatever is behind him — another patient, a colleague, a ward — into a
 * consultation, and on a REFRESH it does it again with no press at all.
 *
 * Voice is also a first-class mode rather than a fallback: `ModeControl` on this very screen
 * offers stepping a consultation down into `voice` or `chat`, and the record says which was
 * used. A pane that treated video as the real thing and voice as a degraded version of it
 * would contradict the record the clinician is writing beside it.
 *
 * And video is roughly ten times the bitrate of audio. On the connection this product is
 * designed for, starting with video is how the audio breaks up — and the audio is where the
 * history is taken.
 *
 * ====================================================================================
 * WHAT THIS FILE MUST NEVER GROW
 * ====================================================================================
 *
 * NO EGRESS, NO RECORDING. A standing non-goal in four documents, and the ABSENCE of a media
 * store is load-bearing in ADR-0004's residency argument. The grant we are handed says
 * `roomRecord: false`, so a client that asked would be refused — the refusal is not the
 * point, the not asking is.
 *
 * NO LIVEKIT DATA CHANNEL, WHICH IS WHY THERE IS NO CHAT IN HERE. The SDK ships a chat
 * component and it would be four lines. In-consultation chat is CLINICAL DATA: it belongs in
 * the tenant database under row-level security and in the patient's record, and `ChatPanel`
 * on this same screen puts it there. A data-channel chat would be a second path for the same
 * text that leaves no record in the patient's file — and a clinician would reasonably believe
 * they had written it down. The grant says `canPublishData: false` for exactly this reason.
 *
 * NO PATIENT NAME, EVER, AND THIS IS THE FILE MOST TEMPTED TO ADD ONE. This console knows the
 * patient's name — it is at the top of the screen — and putting it under their tile is the
 * single most natural change anybody could make here. LiveKit broadcasts a participant's
 * identity to everyone else in the room and writes it into its own operational logs, which
 * sit on a VPS outside the tenant database and outside RLS. The label under the tile below is
 * a literal in this file. It must stay one.
 *
 * @see backend/app/Support/Video/LiveKitAccessToken.php — the grant, written out in full
 * @see deploy/livekit/README.md — the network under this, and what breaks without TURN
 */
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
}: {
  /** The SFU's signalling address. A bare string, not `RoomCredentials` — see the header. */
  url: string
  /** The media credential. Reaches this browser as an RSC prop, never via `document.cookie`. */
  token: string
}) {
  /*
   * Whether the connection could not be established, as opposed to having dropped. The SDK's
   * `ConnectionState` has no terminal "never got there" member — a failed connect leaves it
   * `Disconnected`, which is also what a clean hang-up leaves — and the two need different
   * sentences, so the distinction is kept here.
   */
  const [failed, setFailed] = useState(false)

  /** The browser refused the microphone. The consultation is not over; everything else works. */
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
       * clinical data. What the clinician needs is what to do next, which is on the screen.
       */
      onError={() => setFailed(true)}
      /* A later success clears it, so a reconnect that works stops saying it failed. */
      onConnected={() => setFailed(false)}
      /*
       * A REFUSED MICROPHONE IS A STATE ON A WORKING CONNECTION, NOT A FAILED ONE. A clinician
       * who declined the prompt on this handset last week is still IN the room: they can hear
       * the patient, see them, type to them, and write the note. Only the audio input is narrowed on, so a
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

      <StageBody failed={failed} micBlocked={micBlocked} />
    </LiveKitRoom>
  )
}

/**
 * Everything that needs to read the room, which is everything that needs to be inside the
 * provider above.
 *
 * A separate component rather than a fragment, because the SDK's hooks resolve their room
 * from context, and a hook called in the same component that renders the provider would read
 * the context ABOVE it — which is undefined, and presents as a pane that never updates.
 */
function StageBody({ failed, micBlocked }: { failed: boolean; micBlocked: boolean }) {
  const room = useContextRoom()
  const state = useConnectionState(room)
  const remotes = useRemoteParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()

  /*
   * Camera tracks only. Microphone tracks are handled by `RoomAudioRenderer` above and must
   * not also be rendered here, or the patient's voice plays twice.
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
   * failure is completely silent: the track is subscribed, the connection is healthy, the SDK
   * is happy, and the clinician hears nothing and concludes the patient is not speaking. The
   * SDK exposes the state and a method to clear it, which must be called from a real gesture
   * — hence a button rather than an effect.
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
      /* A refusal is already visible: the button does not latch. */
    })
  }, [localParticipant, isMicrophoneEnabled])

  const toggleCamera = useCallback(() => {
    void localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => {
      /* Same: the control does not latch, and the consultation carries on. */
    })
  }, [localParticipant, isCameraEnabled])

  if (failed) {
    /*
     * A `warn` rather than a `bad`, for the reason the whole pane exists: the clinician is in
     * a working consultation. The picture failed; the note, the prescribing, the record and
     * the messages did not. The loudest colour in the product would be a claim that
     * everything has stopped, on the screen where a clinician decides whether to abandon.
     */
    return (
      <Notice tone="warn" icon="help" title="The picture and sound could not be opened" announce={false}>
        <Stack gap="3">
          <p>
            The consultation is not blocked and nothing you have written is affected. Hold it
            by telephone and record it here as you go — the note, the prescribing and the
            messages below all work.
          </p>
          <p>
            To try again, leave the room and press the door button once more. That mints a
            fresh credential, which is also what to do if this page has been open for over an
            hour.
          </p>
        </Stack>
      </Notice>
    )
  }

  return (
    <>
      <p className="media-status">
        {/* The dot is decoration and the word is the message — the same rule the status
            badges on this screen follow. A dot alone says nothing to a screen reader. */}
        <span className={`media-dot ${dotClass(state)}`} aria-hidden="true" />
        <span>{stateLabel(state)}</span>
      </p>

      {soundBlocked ? (
        <Notice tone="info" icon="phone" title="Press to turn on the sound" announce={false}>
          <Stack gap="4">
            <p>
              This browser will not play sound until something on the page is pressed. Nothing
              is wrong with the connection and the patient may already be speaking.
            </p>
            <div>
              <Button variant="brand" onClick={startSound}>
                Turn on the sound
              </Button>
            </div>
          </Stack>
        </Notice>
      ) : null}

      {micBlocked ? (
        <Notice tone="warn" icon="help" title="This browser is not letting the console use the microphone" announce={false}>
          <p>
            You can hear the patient and write to them below, but they cannot hear you. Allow
            this page to use the microphone in the browser&rsquo;s settings, then leave the room
            and come back in.
          </p>
        </Notice>
      ) : null}

      {/* `--pair` only once there are two people to lay out. One tile in a two-column grid is
          a tile at half width beside a hole. */}
      <div className={`media-grid${remotes.length > 0 ? ' media-grid--pair' : ''}`}>
        <Tile
          /*
           * A ROLE, WRITTEN OUT AS A LITERAL. This console knows the patient's name and it is
           * at the top of this very screen. It does not go here — see the file header.
           */
          label="The patient"
          quiet={remotes.length === 0 ? 'Waiting for the patient to join.' : 'Their camera is off.'}
          track={theirs}
          mirrored={false}
        />
        <Tile label="You" quiet="Your camera is off." track={mine} mirrored />
      </div>

      <div className="media-controls">
        {/*
         * `aria-pressed` rather than only a changing label, so a screen reader announces the
         * control's STATE rather than requiring the listener to infer it from a verb. The
         * visible label still changes, because a sighted user reads the label.
         */}
        <Button variant="quiet" onClick={toggleMic} aria-pressed={isMicrophoneEnabled}>
          {isMicrophoneEnabled ? 'Mute my microphone' : 'Unmute my microphone'}
        </Button>

        <Button variant="quiet" onClick={toggleCamera} aria-pressed={isCameraEnabled}>
          {isCameraEnabled ? 'Turn my camera off' : 'Turn my camera on'}
        </Button>
      </div>
    </>
  )
}

/**
 * One seat.
 *
 * `track` is optional and its absence is the ORDINARY case rather than an error: the camera is
 * off by default on both sides, so a voice consultation renders two of these with no video in
 * either for its whole length. Hence a sentence and not a spinner.
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
 * NARROWED WITH A THROW RATHER THAN A `!`. `RoomContext` is typed `Room | undefined` because
 * the SDK cannot know whether a caller mounted a provider; this file does know, because the
 * only component that renders `StageBody` is the one that renders the provider around it. The
 * throw states that structural fact in a form the compiler accepts and a future refactor would
 * trip over, where a non-null assertion would silently produce `undefined.on(...)`.
 */
function useContextRoom(): Room {
  const room = useContext(RoomContext)

  if (room === undefined) {
    throw new Error('LiveKitStage rendered outside its own RoomContext.Provider')
  }

  return room
}

/** Which of four sentences the status line says. */
function stateLabel(state: ConnectionState): string {
  switch (state) {
    case ConnectionState.Connected:
      return 'Connected'
    case ConnectionState.Reconnecting:
      return 'The connection dropped. Trying again…'
    case ConnectionState.Connecting:
      return 'Connecting…'
    default:
      return 'Not connected'
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
