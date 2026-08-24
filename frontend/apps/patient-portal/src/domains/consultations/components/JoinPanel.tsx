import { getTranslations } from 'next-intl/server'
import { Button, Card, DateTime, Icon, Notice, Stack, formatInstant } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { enterConsultation } from '../api/actions'
import type { ConsultationEntry, ConsultationMode } from '../api/consultations'
import { EmergencyGuidance } from './EmergencyGuidance'
import { PageBody } from '@/components/PageBody'
import { SitePageHeader } from '@/components/SitePageHeader'

/**
 * The join screen: the lobby, and every honest reason there is no door today.
 *
 * THE LINK IS THE PRODUCT. "Both parties join through a link; no app install is required,
 * because requiring one loses patients at exactly the moment they need care." This is what
 * is at the end of the `{join_link}` in the confirmation SMS, it is what the front desk
 * reads down the telephone, and it is what a patient opens again after a dropped call. One
 * URL, four states, and nothing to download.
 *
 * THE BUTTON IS A FORM POST. Not a link, and the reason is not style. The join token is
 * SINGLE-USE: a GET would be spent by a refresh, by the back button, or by the router
 * prefetching a link it can see — and the patient would be locked out of a consultation
 * they have paid for by their own browser. The post also means the whole journey works
 * before the bundle arrives, which is the performance budget's requirement rather than a
 * nicety.
 *
 * WHY THE SCREEN REFUSES BEFORE THE API DOES. Every AuthorizationException the API raises
 * renders as the same 403 — "You do not have permission to do that" — so the join
 * controller's real sentences never reach us. Telling a patient they lack permission to
 * enter their own consultation is both wrong and frightening. So the states below are
 * worked out from the appointment's own status and times, and the button appears only when
 * the room can plausibly be entered. The API remains the authority; this is what to render.
 *
 * NOTHING CLINICAL IS ON THIS PAGE, and there is nothing to remove: the appointment
 * resource carries a time, a reference and a mode, and the reason for the visit is not
 * among them.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md §4 and the exception paths
 */

const MODE_KEY = {
  video: 'mode.video',
  voice: 'mode.voice',
  chat: 'mode.chat',
  in_person: 'mode.inPerson',
} as const satisfies { readonly [M in ConsultationMode]: string }

/** Everything except the room — that screen is ConsultationRoom. */
export type JoinState = Exclude<ConsultationEntry, { kind: 'room' }>

/**
 * Why the last attempt to go in did not work.
 *
 * A CLOSED SET, never the API's raw sentence. See the note on `classify()` in
 * ../api/actions.ts: this value arrives in a URL, and a URL is how a patient arrives at
 * this page, so the only strings this screen speaks are its own.
 */
export type EntryFailure = 'refused' | 'session' | 'failed'

const FAILURE_TITLE = {
  refused: 'entryRefusedTitle',
  session: 'entrySessionTitle',
  failed: 'entryFailedTitle',
} as const satisfies { readonly [F in EntryFailure]: string }

const FAILURE_BODY = {
  refused: 'entryRefusedBody',
  session: 'entrySessionBody',
  failed: 'entryFailedBody',
} as const satisfies { readonly [F in EntryFailure]: string }

export async function JoinPanel({
  tenant,
  state,
  clinicianName,
  emergencyGuidance,
  entryError,
}: {
  tenant: Tenant
  state: JoinState
  clinicianName?: string | undefined
  emergencyGuidance?: string | undefined
  /** What went wrong last time the button was pressed, if anything. */
  entryError?: EntryFailure | undefined
}) {
  const [t, common] = await Promise.all([
    getTranslations('Consultations'),
    getTranslations('Common'),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')
  const phone = tenant.contact?.phone ?? undefined
  const { appointment } = state
  const bookedMode = 'bookedMode' in state ? state.bookedMode : null

  return (
    <PageBody>
      <SitePageHeader eyebrow={t('eyebrow')} title={t('joinTitle')} description={t('joinLede')} />

      <Stack gap="5">
        <Card tone="brand" padding="tight">
          {/*
           * SURVIVING INLINE STYLE, three of them, and the same one every stat block in
           * this app carries. `.stat__value` is 28px because it was sized for a COUNT; the
           * three values here are a date and time, a reference and a clinician's name, and
           * at 28px in the display face any of them takes three lines inside a third of a
           * `.cellgrid` on a phone. 19px is what fits, and 19px is not on the type scale —
           * `.title-sm` is the nearest step at 17.5px and it is a different weight.
           *
           * The right home is a `.stat__value--sm` modifier in tokens/components.css,
           * beside the rule it modifies and shared with the console's matching overrides.
           * That file is outside this sweep, so the property stays and the modifier is the
           * follow-up. See the identical note in src/app/account/page.tsx.
           */}
          <div className="cellgrid cellgrid--3">
            <div className="stat">
              <span className="stat__label">{t('scheduledLabel')}</span>
              <span className="stat__value" style={{ fontSize: 19 }}>
                <DateTime value={appointment.scheduled_start_at} format="datetime" />
              </span>
            </div>

            <div className="stat">
              <span className="stat__label">{t('referenceLabel')}</span>
              {/* The reference is what the clinic and the patient say aloud on the phone,
                  which is how most support in this market happens. `.tnum` keeps it from
                  shifting width as digits change. */}
              <span className="stat__value tnum" style={{ fontSize: 19 }}>
                {appointment.reference}
              </span>
            </div>

            <div className="stat">
              <span className="stat__label">
                {clinicianName ? t('clinicianLabel') : t('bookedAsLabel')}
              </span>
              <span className="stat__value" style={{ fontSize: 19 }}>
                {clinicianName ?? (bookedMode ? t(MODE_KEY[bookedMode]) : '—')}
              </span>
              {clinicianName && bookedMode ? (
                <span className="stat__note">{t(MODE_KEY[bookedMode])}</span>
              ) : null}
            </div>
          </div>
        </Card>

        {entryError ? (
          <Notice tone="bad" title={t(FAILURE_TITLE[entryError])}>
            <Stack gap="3">
              <p>{t(FAILURE_BODY[entryError], { clinic })}</p>
              <p>{phone ? t('callClinic', { clinic, phone }) : t('contactClinic', { clinic })}</p>
            </Stack>
          </Notice>
        ) : null}

        {state.kind === 'lobby' ? (
          <Card as="section" aria-labelledby="what-happens">
            {/* No `marginBottom` here, and there used to be one. `.ticklist` in the token
                layer carries `margin: 24px 0 0`, and this Card is a block container, so the
                heading's 12px collapsed against that 24px and never rendered — a value
                somebody set, nobody saw, and a reviewer would have had to read two
                stylesheets to know was dead. The 24px below is the ticklist's. */}
            <h2 className="title" id="what-happens">
              {t('whatHappensTitle')}
            </h2>

            <ul className="ticklist">
              <li>
                <span className="tk">
                  <Icon name="check" />
                </span>
                <span>{t('whatHappensArrival', { clinic })}</span>
              </li>
              <li>
                <span className="tk">
                  <Icon name="shield" />
                </span>
                <span>{t('whatHappensPass')}</span>
              </li>
              {/* Said BEFORE the button rather than after it. A patient who presses "go in"
                  expecting a face and finds a paragraph has been misled by omission, and the
                  provider flag is not knowable until the pass has been spent — so the
                  warning has to be given in advance or not at all. */}
              <li>
                <span className="tk">
                  <Icon name="help" />
                </span>
                <span>{t('whatHappensHonest', { clinic })}</span>
              </li>
            </ul>

            {/* SURVIVING INLINE STYLES, here and on the note below it. This Card is a
                BLOCK container and has to stay one, because `.ticklist` above brings its
                own 24px `margin-top` from the token layer: inside a `<Stack>` that margin
                would be added to the Stack's gap instead of standing in for it, and the
                list would drift away from its heading. The three gaps down this card are
                24px, 18px and 12px, so no single gap absorbs them either. */}
            <form action={enterConsultation} style={{ marginTop: 'var(--space-6)' }}>
              {/*
               * The identifier travels in the form because a Server Action takes FormData,
               * and it is safe there for the same reason it is safe in the URL: it is an
               * argument to an authorised call, not an assertion. AppointmentPolicy::join
               * and row-level security decide, and another clinic's appointment is a 404.
               */}
              <input type="hidden" name="appointment_id" value={appointment.id} />
              <Button variant="brand" size="lg" block type="submit">
                {t('enter')}
              </Button>
            </form>

            <p className="fine" style={{ marginTop: 'var(--space-4)' }}>
              {t('resumeNote')}
            </p>
          </Card>
        ) : null}

        {state.kind === 'not-open-yet' ? (
          <Notice tone="info" icon="clock" title={t('notOpenTitle')} announce={false}>
            {t('notOpenBody', { opensAt: formatInstant(state.opensAt, 'datetime') })}
          </Notice>
        ) : null}

        {state.kind === 'not-confirmed' ? (
          <Notice tone="warn" icon="card" title={t('notConfirmedTitle')} announce={false}>
            <Stack gap="3">
              <p>{t('notConfirmedBody', { clinic })}</p>
              <p>{phone ? t('callClinic', { clinic, phone }) : t('contactClinic', { clinic })}</p>
            </Stack>
          </Notice>
        ) : null}

        {state.kind === 'finished' ? (
          <Notice tone="neutral" icon="check" title={t('finishedTitle')}>
            {t('finishedBody', { clinic })}
          </Notice>
        ) : null}

        {state.kind === 'closed' ? (
          <Notice tone="neutral" icon="x" title={t('closedTitle')}>
            <Stack gap="3">
              <p>{t('closedBody')}</p>
              <p>{phone ? t('callClinic', { clinic, phone }) : t('contactClinic', { clinic })}</p>
            </Stack>
          </Notice>
        ) : null}

        <EmergencyGuidance clinic={clinic} phone={phone} guidance={emergencyGuidance} />
      </Stack>
    </PageBody>
  )
}
