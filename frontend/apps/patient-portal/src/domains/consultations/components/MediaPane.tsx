import { getTranslations } from 'next-intl/server'
import { Notice, Stack } from '@carevelo/ui'
import type { RoomCredentials } from '../api/room'

/**
 * The media leg — and, today, the honest absence of one.
 *
 * ================================================================================
 * THIS IS THE ONLY FILE THAT CHANGES WHEN A VIDEO PROVIDER IS CHOSEN.
 * ================================================================================
 *
 * That is the whole reason it is a file of its own rather than three lines inside the
 * room. ADR-0004 is still Proposed: the backend binds VideoProvider to
 * UnconfiguredVideoProvider, which brokers nothing and answers
 * `{room, participant, provider: "unconfigured", configured: "false"}`. Its own comment
 * says why that is a value and not a stub — "a join-token endpoint that raises until a
 * commercial decision is made cannot be tested, cannot be built against by the frontend,
 * and would arrive at integration day never having run" — and this component is the
 * frontend half of the same bargain. The token flow, its single-use accounting and its
 * audit trail are exercised for real today; only the picture is missing.
 *
 * WHAT ARRIVING HERE WITH A PROVIDER LOOKS LIKE. `credentials.configured` becomes true and
 * the redeem response carries that provider's own keys alongside the four the platform
 * guarantees. The `configured` branch below becomes `<ProviderMedia …/>`; ./room.ts widens
 * what it remembers to include the keys that provider needs; and nothing else in this
 * domain moves — not the lobby, not the entry flow, not the mode strip, not the chat panel,
 * not the route.
 *
 * WHY IT SAYS SO RATHER THAN SHOWING A PANE. A frozen frame with no explanation is worse
 * than an honest downgrade: "the patient assumes the product is broken and the clinic hears
 * about it." A grey rectangle with a spinner in it is that frame. So there is no rectangle,
 * no spinner, and no "connecting…" — there is a sentence saying video is not switched on
 * yet, and the clinic's telephone number, which is a channel that actually works.
 *
 * NOTE THE STRING COMPARISON, upstream in ./room.ts. `configured` crosses the wire as
 * `'false'`, because VideoProvider::credentialsFor is contracted as `array<string, string>`.
 * `Boolean('false')` is true, and that single coercion would open a dead room on every
 * unconfigured tenant — which is exactly the failure this flag exists to prevent.
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

  if (!credentials.configured) {
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

  /*
   * A provider IS configured and this build cannot open it.
   *
   * Reachable only after ADR-0004 is decided and the backend is rebound, and it is a
   * loud, honest dead end on purpose. The alternative — rendering an empty pane and
   * letting the patient wonder — is the frozen frame again, and this way the first person
   * to see it knows exactly what is missing and can say so to the clinic.
   *
   * REPLACE THIS BRANCH, not the one above, with the provider's component.
   */
  return (
    <Notice tone="bad" icon="help" title={t('mediaNoClientTitle')}>
      {t('mediaNoClientBody', { clinic })}
    </Notice>
  )
}
