import { Badge, Notice, Stack } from '@carevelo/ui'
import type { RoomCredentials } from '../api/room'
import { MODE_LABEL, type ConsultationMode } from '../model/types'

/**
 * The media leg — and, today, the honest absence of one.
 *
 * ====================================================================================
 * THIS IS THE ONLY FILE THAT CHANGES WHEN A VIDEO PROVIDER IS CHOSEN.
 * ====================================================================================
 *
 * That is the whole reason it is a file of its own rather than four lines inside the room.
 * ADR-0004 is still Proposed: the backend binds `VideoProvider` to `UnconfiguredVideoProvider`,
 * which brokers nothing and answers `{room, participant, provider: "unconfigured",
 * configured: "false"}`. Its own comment says why that is a value rather than a stub — "a
 * join-token endpoint that raises until a commercial decision is made cannot be tested, cannot
 * be built against by the frontend, and would arrive at integration day never having run" —
 * and this component is the frontend half of the same bargain. The token flow, its single-use
 * accounting and its audit trail are exercised for real today; only the picture is missing.
 *
 * WHAT ARRIVING HERE WITH A PROVIDER LOOKS LIKE. `credentials.configured` becomes true and the
 * redeem response carries that provider's own keys alongside the four the platform guarantees.
 * The `configured` branch below becomes `<ProviderMedia …/>`; `api/room.ts` widens what it
 * remembers to include the keys that provider needs; and NOTHING ELSE IN THIS DOMAIN MOVES —
 * not the door, not the entry flow, not the mode control, not the note editor, not the route.
 *
 * ====================================================================================
 * WHY IT SAYS SO RATHER THAN SHOWING A PANE
 * ====================================================================================
 *
 * A frozen frame with no explanation is worse than an honest downgrade — the clinician assumes
 * the product is broken and the clinic hears about it. A grey rectangle with a spinner in it
 * IS that frame. So there is no rectangle, no spinner and no "connecting…": there is a
 * sentence saying video is not switched on for this clinic yet, and the mode the consultation
 * is being held in instead, which is a thing that actually works.
 *
 * THE CONSULTATION IS NOT BLOCKED BY THIS. The clinician still holds it — by telephone, in the
 * room, however the clinic already works — and the note, the prescribing and the record all
 * run exactly as they would with a picture. Carevelo records the encounter; it does not have
 * to carry it.
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
  if (!credentials.configured) {
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
            the prescription and the record all work.
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

  /*
   * A provider IS configured and this build cannot open it.
   *
   * Reachable only after ADR-0004 is decided and the backend is rebound, and it is a loud,
   * honest dead end on purpose. The alternative — rendering an empty pane and letting the
   * clinician wonder — is the frozen frame again, and this way the first person to see it
   * knows exactly what is missing.
   *
   * REPLACE THIS BRANCH, not the one above, with the provider's component.
   */
  return (
    <Notice tone="bad" icon="help" title="This console cannot open the video provider">
      <Stack gap="3">
        <p>
          The clinic&rsquo;s server brokered a session with <Badge tone="info">{credentials.provider}</Badge>
          {' '}and this build has no client for it. Tell whoever deployed this console: the
          provider was configured after this version was built.
        </p>
        <p>
          Hold the consultation another way rather than waiting for a picture that is not coming.
        </p>
      </Stack>
    </Notice>
  )
}
