import type { ReactNode } from 'react'
import { Badge, Button, DateTime, Field, Icon, Inline, Input, Stack, Textarea } from '@carevelo/ui'
import { clinicTime } from '../model/day'
import { asStatus, isEnterable, isUnpaidHold, STATUS_LABEL, STATUS_NOTE, STATUS_TONE } from '../model/status'
import type { Appointment, Clinician, Patient, SchedulePaths, Service } from '../model/types'

/**
 * One appointment on the clinic's day.
 *
 * ------------------------------------------------------------------------------------
 * WHAT THIS ROW IS CAREFUL ABOUT, AND WHY
 *
 * HELD IS NOT BOOKED. A prepaid booking sits in `awaiting_payment` and HOLDS the clinician's
 * slot — `AppointmentController::SLOT_HOLDING` counts it — so availability excludes it and
 * nobody else can take that time. Nobody has paid. `appointments:release-unpaid` will take
 * it back. A board that renders it identically to a confirmed booking teaches a clinic that
 * its day is full when a third of it is not, and teaches a clinician to expect a patient who
 * is not coming. So a hold is drawn with a dashed edge, labelled in words, and carries the
 * one sentence that says what will happen to it.
 *
 * IDENTIFIERS ARE NOT NAMES, AND A ULID IS NOT A PATIENT. `AppointmentResource` carries
 * `patient_id`, `clinician_id` and `service_id` and no names at all — correct for a resource
 * that has to be safe to hand a patient, and useless on a day view. The screen above resolves
 * them and passes the resolved records in; when one cannot be resolved this row says so
 * rather than printing a ULID at a clinician, because a ULID on a schedule is worse than a
 * blank: it looks like data.
 *
 * THE REFERENCE IS THE THING STAFF SAY OUT LOUD. `reference` exists because that is how
 * support actually happens in this market — a patient telephones and reads it off an SMS. It
 * is rendered in tabular figures at the top of the row for that reason and not as an
 * afterthought at the bottom.
 *
 * NOTHING HERE IS A CONTROL THAT MIGHT NOT WORK. Every action below is rendered only when
 * the person looking at it may take it, decided from their roles and from the appointment's
 * own state. A button that produces a 403 teaches staff to distrust the whole screen.
 */

export type AppointmentRowProps = {
  appointment: Appointment
  /** Null when the record could not be resolved — see the note above. */
  patient: Patient | null
  service: Service | null
  clinician: Clinician | null
  paths: SchedulePaths
  /** Does the person looking at this hold the clinician role? Decides the room control. */
  isClinician: boolean
  /** Only `clinic_admin` may confirm an unpaid booking on the clinic's authority. */
  isAdministrator: boolean
  /** Bound by the screen: `(formData) => Promise<void>`, closing over where to return to. */
  cancelAction: (formData: FormData) => Promise<void>
  confirmAction: (formData: FormData) => Promise<void>
}

export function AppointmentRow({
  appointment,
  patient,
  service,
  clinician,
  paths,
  isClinician,
  isAdministrator,
  cancelAction,
  confirmAction,
}: AppointmentRowProps) {
  const status = asStatus(appointment.status)
  const held = status !== null && isUnpaidHold(status)
  const enterable = status !== null && isEnterable(status)

  return (
    /*
     * THE DASHED EDGE IS THE SURVIVOR HERE AND IT IS GENUINELY CONDITIONAL — it depends on
     * the appointment's own state, which no class in the token layer knows about. It is the
     * one visual difference between a hold and a booking, and it is deliberately structural
     * rather than a colour: a dashed edge survives a colour-blind reader and a printed rota,
     * and the badge beside it says the same thing in words. The gap that shared this object
     * has moved to the Stack, so what is left states one thing.
     */
    <article
      className="card"
      style={held ? { borderStyle: 'dashed' } : undefined}
      aria-label={`${clinicTime(appointment.scheduled_start_at)} — ${describe(patient)}`}
    >
      <Stack gap="4">
        <Inline gap="5" justify="between">
          <Inline gap="5" wrap={false}>
            {/* Tabular figures, because a column of times that shifts width as digits change is
                hard to scan and this screen is nothing but times. */}
            <span className="head-font tnum slot-time">
              <DateTime value={appointment.scheduled_start_at} format="time" />
            </span>
            <span className="fine tnum">
              to <DateTime value={appointment.scheduled_end_at} format="time" />
            </span>
          </Inline>

          <Inline gap="3">
            {status === null ? (
              // A status the contract does not know about. Saying nothing is better than
              // asserting something wrong about a booking.
              <Badge tone="neutral">Unknown state</Badge>
            ) : (
              <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
            )}
            <Badge tone="neutral" icon="activity">
              {MODE_LABEL[appointment.mode_booked] ?? appointment.mode_booked}
            </Badge>
          </Inline>
        </Inline>

        <Stack gap="2">
          <p className="record-name">{describe(patient)}</p>
          {/* KEPT, AND WORTH LOOKING AT RATHER THAN COPYING. `--text-base-size` is 14.5px, so
              this overrides the body size by half a pixel — which is not a decision anybody
              made, it is a `14` typed where the scale was not to hand. There is no 14px class
              to move it to: `.record-name` above it lives in console.css because this same
              "the name of the record" idea was written five different ways, and the line under
              a record name wants the same treatment there. console.css is not this task's file,
              so the number stays visible instead of being quietly deleted. Named in the report. */}
          <p className="muted" style={{ fontSize: 14 }}>
            {service?.name ?? 'Service could not be resolved'}
            {clinician ? ` · ${clinician.name}` : null}
          </p>
          <p className="fine mono">{appointment.reference}</p>
        </Stack>

        {status !== null && STATUS_NOTE[status] ? (
          /* `.fine` is `--ink-faint`; this line wanted `--ink-muted`, which is exactly what
             `.muted` is, and it is declared after `.fine` in typography.css so it wins on
             order at equal specificity. A named colour rather than the same variable spelled
             out by hand at a call site. */
          <p className="fine muted">{STATUS_NOTE[status]}</p>
        ) : null}

        <Inline gap="3">
          {/*
            * THE ROOM IS OFFERED ONLY TO A CLINICIAN, AND ONLY WHEN THE STATUS ALLOWS IT.
            * `AppointmentPolicy::join` admits the clinician and the patient and deliberately
            * excludes the administrator — reading that a consultation happened is one act and
            * sitting in on one is another, and no clinic asked for the second. Rendering the
            * control for an administrator would be rendering a 403.
            */}
          {isClinician && enterable ? (
            <Button variant="primary" href={paths.room(appointment.id)}>
              <Icon name="activity" /> Open consultation
            </Button>
          ) : null}

          {/*
            * THE RECORD, AFTER THE ENCOUNTER IS OVER, AND THIS LINK IS NOT OPTIONAL.
            *
            * A prescription can only be issued on a consultation whose outcome is `completed`,
            * and ending the consultation is what sets that — which also moves the APPOINTMENT to
            * `completed`. So the moment prescribing becomes possible, the appointment stops being
            * enterable. A clinician who closed the tab between the two would have no way back to
            * the only screen that can issue the prescription. This is that way back.
            */}
          {isClinician && (status === 'completed' || status === 'abandoned') ? (
            <Button variant="quiet" href={paths.room(appointment.id)}>
              <Icon name="file" /> Open the record
            </Button>
          ) : null}

          {isAdministrator && status !== null && (status === 'awaiting_payment' || status === 'payment_failed') ? (
            <ConfirmOnAuthority appointment={appointment} action={confirmAction} />
          ) : null}

          {status !== null && (status === 'awaiting_payment' || status === 'confirmed' || status === 'payment_failed') ? (
            <CancelBooking appointment={appointment} action={cancelAction} />
          ) : null}
        </Inline>
      </Stack>
    </article>
  )
}

/**
 * The four modes, in words.
 *
 * VOICE AND CHAT ARE NOT "DEGRADED". They are first-class bookable choices for a patient who
 * knows their connection will not carry video, and the labels treat them as equals — no
 * "(fallback)", no parenthetical apology.
 */
const MODE_LABEL: Record<string, string> = {
  in_person: 'In person',
  video: 'Video',
  voice: 'Voice',
  chat: 'Chat',
}

/**
 * The patient, or an honest statement that we could not name them.
 *
 * Never the identifier. See the header: a ULID printed where a name belongs looks like data
 * and is not.
 */
function describe(patient: Patient | null): string {
  if (patient === null) {
    return 'Patient record unavailable'
  }

  return `${patient.given_name} ${patient.family_name}`.trim()
}

/**
 * Cancelling, with the reason the API requires and the warning the API cannot give.
 *
 * A `<details>` rather than a modal, and that is not laziness. `packages/ui` has no Modal —
 * "a component built on a guess is a component someone has to work around later" — and a
 * disclosure works with no JavaScript at all, which on a console reached from a phone
 * between rooms is the difference between a control and a decoration.
 *
 * THE HINT IS A COMPLIANCE CONTROL, NOT A COURTESY. The reason is stored on the appointment
 * and never copied into the audit trail, precisely because free text typed at a front desk
 * routinely names a condition. A receptionist who has not been told that will write one, and
 * it will sit in a field that is read by the next person to open the booking.
 */
function CancelBooking({
  appointment,
  action,
}: {
  appointment: Appointment
  action: (formData: FormData) => Promise<void>
}): ReactNode {
  return (
    <details>
      <summary className="lnk disclose">
        <Icon name="x" /> Cancel this appointment
      </summary>

      {/* The margin is the space between a disclosure's summary and its content, and it
          cannot become a gap: `<details>` shows and hides its own non-summary children, and
          giving it `display: flex` is the one change that breaks that — Chrome renders the
          content while the disclosure is CLOSED. So the offset stays a margin on the form and
          the column inside it is a Stack. Same reasoning as NoteThread; one `.disclose`
          content rule in console.css would retire all four. */}
      <form action={action} style={{ marginTop: 'var(--space-4)' }}>
        <Stack gap="4">
          <input type="hidden" name="appointment_id" value={appointment.id} />

          <Field
            name={`reason-${appointment.id}`}
            label="Why is this being cancelled?"
            hint="Do not write anything clinical here. This is stored on the booking and read by whoever opens it next; keep it to the arrangement — 'patient rescheduled', 'clinician unavailable'."
          >
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                required
                minLength={3}
                maxLength={255}
                rows={2}
                placeholder="Patient rescheduled"
              />
            )}
          </Field>

          <div>
            <Button variant="danger" type="submit">
              Cancel and release the slot
            </Button>
          </div>
        </Stack>
      </form>
    </details>
  )
}

/**
 * Confirming an unpaid booking on the clinic's authority.
 *
 * Administrator only, by policy, and audited by name. The copy says what is actually being
 * asserted — that the clinic will collect, or already has — rather than "confirm", because
 * "confirm" invites somebody to press it to tidy the board.
 */
function ConfirmOnAuthority({
  appointment,
  action,
}: {
  appointment: Appointment
  action: (formData: FormData) => Promise<void>
}): ReactNode {
  return (
    <details>
      <summary className="lnk disclose">
        <Icon name="check" /> Confirm without payment
      </summary>

      {/* The same disclosure offset, kept for the same reason as the cancel form above. */}
      <form action={action} style={{ marginTop: 'var(--space-4)' }}>
        <Stack gap="4">
          <input type="hidden" name="appointment_id" value={appointment.id} />

          <p className="fine measure">
            You are vouching that this patient will settle at the desk, or that the clinic has
            seen a transfer Carevelo has not. The appointment becomes confirmed and the slot
            stops being a hold. This is recorded against your name.
          </p>

          {/* Not a decorative acknowledgement. The API cannot tell an accidental press from a
              deliberate one, and this is the only place the difference can be made. */}
          <Field name={`vouch-${appointment.id}`} label="Type CONFIRM to continue">
            {(control) => (
              /* Case-insensitive on purpose: the server compares upper-cased, and a browser
                 refusing "confirm" while the server would have accepted it is a control that
                 disagrees with itself. */
              <Input
                {...control}
                name="vouch"
                required
                autoComplete="off"
                pattern="[Cc][Oo][Nn][Ff][Ii][Rr][Mm]"
              />
            )}
          </Field>

          <div>
            <Button variant="primary" type="submit">
              Confirm on the clinic&rsquo;s authority
            </Button>
          </div>
        </Stack>
      </form>
    </details>
  )
}
