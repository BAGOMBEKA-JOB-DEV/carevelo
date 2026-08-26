import { getTranslations } from 'next-intl/server'
import { Notice, Stack } from '@carevelo/ui'
import { mediaState } from '../model/media'
import type { RoomCredentials } from '../api/room'
import { VideoStage } from './VideoStage'

/**
 * The media leg: which of two truths this clinic is living in.
 *
 * ================================================================================
 * IT IS A TWO-WAY SWITCH AND NOTHING MORE. THAT IS THE WHOLE JOB.
 * ================================================================================
 *
 * ADR-0004 is now Accepted — LiveKit, SELF-HOSTED, chosen on cost — and the client SDK has
 * landed behind `VideoStage`, so the branch below this one really does open a picture now.
 * The split is unchanged by that: `VideoStage` owns everything about a clinic that HAS a
 * media server, this component owns the choice and the honest fallback for a clinic that
 * does not, and NEITHER of those two jobs got bigger when video started working.
 *
 * The three-way question — no server, a server we cannot reach, a server we can — is decided
 * once by `mediaState` below and handed down as a narrowed value. This component reads only
 * the first answer.
 *
 * THE UNCONFIGURED BRANCH BELOW IS UNCHANGED, DELIBERATELY, AND IT IS NOT A PLACEHOLDER.
 * It is the correct product behaviour for every clinic that has not deployed an SFU, which
 * is all of them until one is deployed, and for a production evening where a rotated secret
 * did not make it into the environment. `UnconfiguredVideoProvider` still exists on the
 * backend for exactly that reason and says so at length. A warn notice plus the clinic's
 * telephone number is a channel that works; a grey rectangle with a spinner is the frozen
 * frame the whole degradation design exists to prevent, and it invites waiting.
 *
 * ================================================================================
 * THE COERCION THAT DECIDES WHICH BRANCH RUNS
 * ================================================================================
 *
 * `credentials.configured` is already a real boolean by the time it reaches here, because
 * `api/room.ts` coerced it through `isMediaConfigured` — which compares against the STRING
 * `'true'`, because `VideoProvider::credentialsFor` is contracted as `array<string, string>`
 * and `Boolean('false')` is `true`. One truthiness check upstream would open a dead room for
 * every patient of every unconfigured clinic. That decision now has a name and a test:
 * `../model/media.ts` and `media.test.ts`.
 *
 * @see backend/app/Support/Video/UnconfiguredVideoProvider.php
 * @see docs/70-decisions/0004-video-provider-selection.md
 */
export async function MediaPane({
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
   * DECIDED ONCE, HERE, AND HANDED DOWN NARROWED. `VideoStage` takes the state rather than
   * the raw credentials precisely so that it cannot re-derive it: two copies of this call
   * with two different arguments is how one screen ends up disagreeing with the other about
   * whether a clinic has video.
   */
  const state = mediaState(credentials.configured, credentials.url, credentials.token)

  if (state.kind === 'unconfigured') {
    return (
      <Notice tone="warn" icon="phone" title={t('mediaUnavailableTitle')} announce={false}>
        <Stack gap="3">
          <p>{t('mediaUnavailableBody', { clinic })}</p>
          {/* A whole sentence of its own rather than a clause appended to the one above:
              the number is the working alternative, and it should read as an instruction
              rather than as a footnote to an apology. */}
          <p>{phone ? t('callClinic', { clinic, phone }) : t('contactClinic', { clinic })}</p>
        </Stack>
      </Notice>
    )
  }

  // A media server IS configured for this clinic. Everything about that case — the working
  // room and the honest dead end when an old entry carries no credential — is in one file.
  return <VideoStage clinic={clinic} phone={phone} credentials={credentials} state={state} />
}
