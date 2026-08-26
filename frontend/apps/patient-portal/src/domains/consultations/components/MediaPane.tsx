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
 * ADR-0004 is now Accepted — LiveKit, SELF-HOSTED, chosen on cost — so the branch that used
 * to be unreachable is reachable, and the file has been split along the seam rather than
 * grown. `VideoStage` owns everything about a clinic that HAS a media server; this component
 * owns the choice and the honest fallback for a clinic that does not.
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

  if (mediaState(credentials.configured) === 'unconfigured') {
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

  // A media server IS configured for this clinic. Everything about that case, including the
  // exact three steps for wiring the LiveKit SDK, is in one file.
  return <VideoStage clinic={clinic} phone={phone} credentials={credentials} />
}
