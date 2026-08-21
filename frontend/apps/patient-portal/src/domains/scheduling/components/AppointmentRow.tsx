import { getTranslations } from 'next-intl/server'
import {
  Badge,
  Button,
  Card,
  DateTime,
  Field,
  Icon,
  Notice,
  Textarea,
  formatInstant,
} from '@carevelo/ui'
import { UNPAID_HOLD_MINUTES, holdExpiresAt } from '../model/hold'
import { href } from '../model/links'
import { MODE_ICON, isConsultationMode } from '../model/slots'
import { STATUS_ICON, STATUS_TONE, knownStatus } from '../model/status'
import type { Appointment, ConsultationMode, SchedulingPaths } from '../model/types'
import { HoldCountdown } from './HoldCountdown'
import type { ModeText, StatusText } from './strings'

/**
 * ONE BOOKING, as the patient who made it sees it.
 *
 * THE SERVICE NAME IS RESOLVED HERE, NOT SENT BY THE API, and the reason is worth having
 * in front of you while reading this file. `AppointmentResource` returns `service_id` and
 * no name, deliberately: "Antenatal Review" is health information about the person who
 * booked it, and a name on the resource is a name in every log line, every cache and
 * every notification that resource ever reaches. The client already holds the clinic's
 * catalogue, so it does the join itself — in-app, behind authentication, which is the one
 * place clinical content is allowed to appear. It is never put in an SMS, and this
 * component is never rendered into one.
 *
 * A SERVICE THAT NO LONGER RESOLVES IS SAID SO PLAINLY. `is_active = false` keeps the row
 * for historical appointments but drops it from the patient's copy of the catalogue, so a
 * booking from last year can point at something this screen cannot name. "No longer
 * offered" is the honest answer; a blank line would read as a bug and a guessed name
 * would be worse.
 */
export async function AppointmentRow({
  appointment,
  serviceName,
  clinicianName,
  clinic,
  modes,
  statuses,
  paths,
  cancelAction,
}: {
  appointment: Appointment
  /** From the service catalogue, or null when the clinic has withdrawn it. */
  serviceName: string | null
  clinicianName: string | null
  clinic: string
  modes: Record<ConsultationMode, ModeText>
  statuses: StatusText
  paths: SchedulingPaths
  /**
   * The screen's cancellation action, passed down rather than created per row.
   *
   * ONE ENCRYPTED CLOSURE INSTEAD OF TWENTY-FIVE. The action takes the appointment id
   * from a hidden field, which is safe because it is a REFERENCE rather than an
   * assertion: `AppointmentPolicy::cancel` admits only the patient the appointment
   * belongs to, so a forged id from another patient is a 403 and one from another clinic
   * is a 404 — never a cancellation. What must never come from the form is the redirect
   * target, and that stays in the closure.
   *
   * Absent when this appointment is in a state the machine cannot cancel from.
   */
  cancelAction?: ((formData: FormData) => Promise<void>) | undefined
}) {
  const t = await getTranslations('Scheduling')

  const status = knownStatus(appointment.status)
  const mode = isConsultationMode(appointment.mode_booked) ? appointment.mode_booked : null
  const expiresAt = holdExpiresAt(appointment)

  // `undefined` is a value `BadgeProps.icon` accepts, so there is nothing to branch on at
  // the call site — which keeps the JSX readable and the optionality in one expression.
  const statusIcon = status ? STATUS_ICON[status] : undefined

  return (
    <Card as="li">
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <div className="row-wrap between" style={{ gap: 'var(--space-4)' }}>
          <Badge tone={status ? STATUS_TONE[status] : 'neutral'} icon={statusIcon}>
            {status ? statuses.known[status] : statuses.unknown}
          </Badge>

          {/* The number a patient reads out on the telephone, which is how most support in
              this market happens. Tabular figures so it is easy to read aloud. */}
          <span className="fine tnum">
            {t('appointments.referenceLabel')} {appointment.reference}
          </span>
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 650 }}>
          {serviceName ?? t('appointments.serviceUnknown')}
        </h2>

        <p className="row-wrap" style={{ gap: 'var(--space-2)', fontSize: 14.5 }}>
          <Icon name="calendar" size={16} />
          {/* UTC on the wire, Africa/Kampala on the screen, 24-hour — all of which
              `<DateTime>` owns so that no screen has to remember it. */}
          <DateTime value={appointment.scheduled_start_at} format="datetime" />
          <span aria-hidden="true">–</span>
          <DateTime value={appointment.scheduled_end_at} format="time" />
        </p>

        <p className="row-wrap fine" style={{ gap: 'var(--space-2)' }}>
          <Icon name="user" size={16} />
          {clinicianName
            ? t('appointments.withClinician', { clinician: clinicianName })
            : t('appointments.clinicianUnknown')}
        </p>

        {mode ? (
          <p className="row-wrap fine" style={{ gap: 'var(--space-2)' }}>
            <Icon name={MODE_ICON[mode]} size={16} />
            {modes[mode].label}
          </p>
        ) : null}

        {expiresAt ? (
          /*
           * THE HOLD, TOLD HONESTLY. Availability excludes a slot in `awaiting_payment`,
           * so this is a real quarter of an hour taken out of the clinic's calendar and
           * given to one person. The deadline is server-rendered text — it works with no
           * JavaScript at all — and the ticking remainder beside it is the only thing on
           * this surface that needs a browser.
           */
          <Notice tone="warn" icon="clock" title={t('appointments.holdTitle')}>
            <div className="stack" style={{ gap: 'var(--space-3)' }}>
              <span>
                {t('appointments.holdBody', {
                  time: formatInstant(expiresAt, 'time'),
                  clinic,
                })}
              </span>

              <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
                <HoldCountdown
                  expiresAt={expiresAt}
                  labels={Array.from({ length: UNPAID_HOLD_MINUTES + 1 }, (_, minutes) =>
                    t('appointments.holdMinutesLeft', { minutes }),
                  )}
                  ended={t('appointments.holdEnded')}
                />

                {paths.payment !== undefined ? (
                  <Button
                    variant="brand"
                    href={href(paths.payment, { appointment: appointment.id })}
                  >
                    <Icon name="coins" /> {t('appointments.payNow')}
                  </Button>
                ) : null}
              </div>
            </div>
          </Notice>
        ) : null}

        {cancelAction ? (
          /*
           * A native <details>, so cancelling is one tap away and nought bytes of
           * JavaScript. Folded rather than open because cancelling is the rare, weighty
           * action on this row and a red button sitting under every appointment invites
           * the wrong tap on a cracked screen.
           */
          <details>
            <summary
              style={{
                cursor: 'pointer',
                color: 'var(--ink-2)',
                fontSize: 13,
                fontWeight: 600,
                paddingBlock: 'var(--space-2)',
              }}
            >
              {t('appointments.cancelSummary')}
            </summary>

            <form action={cancelAction} className="stack" style={{ gap: 'var(--space-4)' }}>
              <input type="hidden" name="appointment_id" value={appointment.id} />

              {/* `id` rather than `name` made unique: several of these forms share one
                  document, so the label/control wiring needs distinct ids while the POSTed
                  field stays `reason`, which is what the API validates. */}
              <Field
                name="reason"
                id={`cancel-reason-${appointment.id}`}
                label={t('appointments.cancelReasonLabel')}
                hint={t('appointments.cancelReasonHint')}
              >
                {(control) => (
                  /* The API requires three characters and stores this on the appointment.
                     It is deliberately never copied into the audit trail, because free
                     text typed by a patient routinely names a condition — which is also
                     why the hint asks them not to write one. */
                  <Textarea {...control} required minLength={3} maxLength={255} rows={3} />
                )}
              </Field>

              <Button type="submit" variant="danger">
                {t('appointments.cancelSubmit')}
              </Button>
            </form>
          </details>
        ) : null}
      </div>
    </Card>
  )
}
