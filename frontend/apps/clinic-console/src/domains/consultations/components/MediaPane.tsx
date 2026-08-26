import { Notice, Stack } from '@carevelo/ui'
import { mediaState } from '../model/media'
import { MODE_LABEL, type ConsultationMode } from '../model/types'
import type { RoomCredentials } from '../api/room'
import { VideoStage } from './VideoStage'

/**
 * The media leg: which of two truths this clinic is living in.
 *
 * ====================================================================================
 * IT IS A TWO-WAY SWITCH AND NOTHING MORE. THAT IS THE WHOLE JOB.
 * ====================================================================================
 *
 * ADR-0004 is now Accepted — LiveKit, SELF-HOSTED, chosen on cost — and the client SDK has
 * landed behind `VideoStage`, so the branch below this one really does open a picture now.
 * The split is unchanged by that: `VideoStage` owns everything about a clinic that HAS a
 * media server, this component owns the choice and the honest fallback for a clinic that does
 * not, and NEITHER of those two jobs got bigger when video started working.
 *
 * The three-way question — no server, a server we cannot reach, a server we can — is decided
 * once by `mediaState` below and handed down as a narrowed value. This component reads only
 * the first answer.
 *
 * THE UNCONFIGURED BRANCH BELOW IS UNCHANGED, DELIBERATELY, AND IT IS NOT A PLACEHOLDER. It
 * is the correct product behaviour for every clinic that has not deployed an SFU — which is
 * all of them until one is deployed — and for a production evening where a rotated secret did
 * not make it into the environment. `UnconfiguredVideoProvider` still exists on the backend
 * for exactly that reason and says so at length.
 *
 * A frozen frame with no explanation is worse than an honest downgrade: the clinician assumes
 * the product is broken and the clinic hears about it. A grey rectangle with a spinner IS
 * that frame. So there is no rectangle, no spinner and no "connecting…" — there is a sentence
 * saying video is not switched on for this clinic, and the mode the consultation is being
 * held in instead, which is a thing that actually works.
 *
 * THE CONSULTATION IS NOT BLOCKED BY EITHER BRANCH. The clinician still holds it — by
 * telephone, in the room, however the clinic already works — and the note, the prescribing,
 * the record and now the messages all run exactly as they would with a picture. Carevelo
 * records the encounter; it does not have to carry it.
 *
 * ====================================================================================
 * THE COERCION THAT DECIDES WHICH BRANCH RUNS
 * ====================================================================================
 *
 * `credentials.configured` is already a real boolean here, because `api/room.ts` coerced it
 * through `isMediaConfigured` — which compares against the STRING `'true'`, because
 * `VideoProvider::credentialsFor` is contracted as `array<string, string>` and
 * `Boolean('false')` is `true`. One truthiness check upstream would open a dead room on every
 * unconfigured tenant. That decision now has a name and a test: `../model/media.ts` and
 * `media.test.ts`.
 */
export function MediaPane({
  credentials,
  mode,
  clinicPhone,
}: {
  credentials: RoomCredentials
  /** What the consultation is actually being held in, per the record. */
  mode: ConsultationMode | null
  clinicPhone?: string | null | undefined
}) {
  /*
   * DECIDED ONCE, HERE, AND HANDED DOWN NARROWED. `VideoStage` takes the state rather than the
   * raw credentials precisely so that it cannot re-derive it: two copies of this call with two
   * different arguments is how one screen ends up disagreeing with the other about whether a
   * clinic has video.
   */
  const state = mediaState(credentials.configured, credentials.url, credentials.token)

  if (state.kind === 'unconfigured') {
    return (
      <Notice tone="warn" icon="phone" title="Video is not switched on for this clinic yet">
        {/* `<Notice>` puts its children in a plain div with no gap, because most notices are
            one paragraph. This one is three, and each carried its own `marginTop` saying the
            space below the paragraph above it. One column, said once. */}
        <Stack gap="3">
          <p>
            Carevelo has not been connected to a video provider, so there is no picture to show
            you. This is not a fault on this device and nothing is loading in the background.
          </p>
          <p>
            Hold the consultation the way the clinic already does — {' '}
            {mode === null ? 'by telephone' : MODE_LABEL[mode].toLowerCase()}
            {clinicPhone ? ` on ${clinicPhone}` : null} — and record it here as you go. The note,
            the prescription, the record and the messages below all work.
          </p>
          <p className="fine">
            Room {credentials.room} · you are joined as {credentials.participant}. That pair is
            all a provider would ever be told: a room name and a role, never a name and never a
            reason for the visit.
          </p>
        </Stack>
      </Notice>
    )
  }

  // A media server IS configured for this clinic. Everything about that case — the working
  // room and the honest dead end when an old entry carries no credential — is in one file.
  return <VideoStage credentials={credentials} mode={mode} state={state} />
}
