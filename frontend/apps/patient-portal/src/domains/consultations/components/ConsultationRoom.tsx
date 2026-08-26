import { getTranslations } from 'next-intl/server'
import { Badge, Button, Card, DateTime, Notice, Stack } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { leaveConsultation } from '../api/actions'
import { consultationHref } from '../api/paths'
import { roomSignature, type Appointment, type Consultation, type ConsultationMode } from '../api/consultations'
import type { ConsultationMessage } from '../model/chat'
import type { RoomCredentials } from '../api/room'
import { ChatPanel } from './ChatPanel'
import { EmergencyGuidance } from './EmergencyGuidance'
import { MediaPane } from './MediaPane'
import { ModeStrip } from './ModeStrip'
import { RoomLive } from './RoomLive'
import { PageBody } from '@/components/PageBody'
import { SitePageHeader } from '@/components/SitePageHeader'

/**
 * The patient's consultation room.
 *
 * A SERVER COMPONENT WITH ONE CLIENT CHILD. Everything a patient needs to read is in the
 * first HTML byte; `RoomLive` adds only the noticing, and the page carries a plain "check
 * now" navigation so that a patient whose JavaScript never arrives loses freshness and no
 * function. That is the performance budget's requirement rather than a preference — the
 * binding constraint is a mid-range Android on variable mobile data, and this is the screen
 * that person opens when they are ill.
 *
 * THE ROOM IS REAL EVEN THOUGH THE PICTURE IS NOT. Being here means a short-lived,
 * single-use, participant-bound token was issued and spent, two audit events were written,
 * and the clinic can see that this patient arrived. What is missing is the media leg, and
 * exactly one component knows that: see MediaPane, which is the only file that changes when
 * ADR-0004 chooses a provider.
 *
 * THE ORDER OF THINGS ON THE PAGE IS THE ARGUMENT. What is happening (the state of the
 * consultation) comes before how it is being held (the mode), which comes before the media,
 * which comes before messages. A patient who reads only the first two inches of this page
 * has read the part that tells them whether anyone is coming.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md §4
 * @see docs/30-architecture/realtime-and-video.md
 */
export async function ConsultationRoom({
  tenant,
  appointment,
  bookedMode,
  credentials,
  consultation,
  messages,
  clinicianName,
  emergencyGuidance,
}: {
  tenant: Tenant
  appointment: Appointment
  bookedMode: ConsultationMode | null
  credentials: RoomCredentials
  /** Null until the clinician starts the consultation, which is the state on arrival. */
  consultation: Consultation | null
  /** The transcript, or null when it could not be read. Null is NOT empty — see ChatPanel. */
  messages: readonly ConsultationMessage[] | null
  clinicianName?: string | undefined
  emergencyGuidance?: string | undefined
}) {
  const [t, common] = await Promise.all([
    getTranslations('Consultations'),
    getTranslations('Common'),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')
  const phone = tenant.contact?.phone ?? undefined
  const ended = consultation?.ended_at != null
  const href = consultationHref(appointment.id)

  return (
    <PageBody>
      <SitePageHeader
        eyebrow={t('eyebrow')}
        title={t('roomTitle')}
        description={t('roomLede', { clinic })}
        actions={
          /* The word carries the state; the colour is a second opinion. A badge that said
             it in colour alone would say nothing to a colour-blind patient and less to a
             screen reader. */
          ended ? (
            <Badge tone="neutral" icon="check">
              {t('statusEnded')}
            </Badge>
          ) : consultation ? (
            <Badge tone="good" icon="activity">
              {t('statusInProgress')}
            </Badge>
          ) : (
            <Badge tone="warn" icon="clock">
              {t('statusWaiting')}
            </Badge>
          )
        }
      />

      <Stack gap="5">
        {consultation ? (
          <ModeStrip clinic={clinic} bookedMode={bookedMode} consultation={consultation} />
        ) : (
          <Notice tone="info" icon="clock" title={t('notStartedTitle')} announce={false}>
            <Stack gap="4">
              <p>{t('notStartedBody')}</p>

              {/* The button keeps its own block wrapper rather than becoming a direct child
                  of the Stack: `.btn` is `inline-flex`, so as a flex item it would be
                  stretched the full width of the notice by the column's default `stretch`,
                  and a full-bleed "Check now" reads as the page's primary action. */}
              <p>
                {/*
                 * A PLAIN ANCHOR, not next/link. This is the no-JavaScript way to see what
                 * has changed, and a soft navigation could serve the router's cached render
                 * of the very page the patient is trying to get past. A full document load
                 * re-runs the server component and cannot be stale.
                 */}
                <Button variant="quiet" href={href}>
                  {t('checkNow')}
                </Button>
              </p>
            </Stack>
          </Notice>
        )}

        {/*
          * THE SIGNATURE NOW CARRIES THE MESSAGE COUNT, which is what makes chat live. A
          * message arriving changes the string, this component notices on its next tick and
          * calls `router.refresh()`, and the SERVER renders the new line into the transcript
          * below. The browser is told only that something moved. See `roomSignature`.
          */}
        <RoomLive
          appointmentId={appointment.id}
          signature={roomSignature(consultation, messages?.length ?? 0)}
          hasEnded={ended}
          label={t('updatesOnItsOwn')}
        />

        <Card as="section" aria-labelledby="consultation-media">
          <Stack gap="4">
            <h2 className="title" id="consultation-media">
              {t('mediaTitle')}
            </h2>

            <MediaPane clinic={clinic} phone={phone} credentials={credentials} />
          </Stack>
        </Card>

        {/* ALWAYS PRESENT, IN EVERY MODE. Chat is not a fallback — and it is also the thing
            that still works when the media pane above has nothing to show, which is why the
            two are next to each other rather than in separate places. */}
        <ChatPanel clinic={clinic} consultation={consultation} messages={messages} />

        <Card tone="brand" padding="tight">
          {/* SURVIVING INLINE STYLE, three of them — `.stat__value` is 28px, sized for a
              count, and a date, a reference and a name at 28px in the display face wrap to
              three lines inside a third of a `.cellgrid` on a phone. The full argument, and
              the `.stat__value--sm` modifier that should retire it, is written out at the
              same block in JoinPanel.tsx. */}
          <div className="cellgrid cellgrid--3">
            <div className="stat">
              <span className="stat__label">{t('scheduledLabel')}</span>
              <span className="stat__value stat__value--sm">
                <DateTime value={appointment.scheduled_start_at} format="datetime" />
              </span>
            </div>

            <div className="stat">
              <span className="stat__label">{t('referenceLabel')}</span>
              <span className="stat__value stat__value--sm tnum">
                {appointment.reference}
              </span>
            </div>

            {clinicianName ? (
              <div className="stat">
                <span className="stat__label">{t('clinicianLabel')}</span>
                <span className="stat__value stat__value--sm">
                  {clinicianName}
                </span>
              </div>
            ) : null}
          </div>
        </Card>

        <EmergencyGuidance clinic={clinic} phone={phone} guidance={emergencyGuidance} />

        {/*
         * A FORM, NOT A LINK. Leaving changes state on the server — it forgets the entry —
         * and a link is a GET that the router may prefetch merely because the page rendered
         * it. A patient thrown out of a live consultation because their browser looked at
         * the page is the bug this shape makes impossible.
         */}
        <form action={leaveConsultation}>
          <Stack gap="3">
            <input type="hidden" name="appointment_id" value={appointment.id} />
            {/* The button in its own block wrapper, for the reason given above: `.btn` is
                `inline-flex` and a bare flex item would be stretched across the card, so a
                quiet "Leave" would come out looking like the primary action. */}
            <div>
              <Button variant="quiet" type="submit">
                {t('leave')}
              </Button>
            </div>
            <p className="fine">{t('leaveNote')}</p>
          </Stack>
        </form>
      </Stack>
    </PageBody>
  )
}
