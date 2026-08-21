import { redirect } from 'next/navigation'
import { Button, EmptyState, Icon, Notice, Select } from '@carevelo/ui'
import { attempt, type Staff } from '../api/gateway'
import { cancelAppointment, confirmDeferred, listAppointments } from '../api/appointments'
import { byId, getPatient, listClinicians, listServices } from '../api/catalogue'
import { dayOrToday, isToday, readableDay, shiftDay, today } from '../model/day'
import { href } from '../model/links'
import { occupiesSlot, asStatus } from '../model/status'
import type { Appointment, Clinician, Patient, SchedulePaths, Service } from '../model/types'
import { AppointmentRow } from './AppointmentRow'
import { DayLive } from './DayLive'

/**
 * THE CLINICIAN'S DAY.
 *
 * ------------------------------------------------------------------------------------
 * WHAT THIS SCREEN IS FOR, IN ONE SENTENCE
 *
 * A clinician arriving at the clinic wants to know who is coming, when, for what, and which
 * of those they can start right now. Everything below serves that and nothing else; the
 * clinic's week, its utilisation and its revenue are other screens' problems.
 *
 * ------------------------------------------------------------------------------------
 * WHY THE DAY IS IN THE URL
 *
 * `?day=` and `?clinician=` are ordinary query parameters, the day navigation is three
 * anchors, and the clinician filter is a `<form method="get">` with a submit button. No
 * JavaScript is involved in any of it. That is not a purity exercise: this console is opened
 * on a mid-range Android between consulting rooms, and a day view that needs a bundle before
 * it can change days is a day view that does not work in the corridor. It also means every
 * state of this screen is a URL somebody can send to a colleague.
 *
 * BOTH VALUES ARE VALIDATED, NOT TRUSTED. `?day=banana` renders today rather than sending a
 * 422 to the API and showing a clinician an error where their schedule should be.
 *
 * ------------------------------------------------------------------------------------
 * WHY THE ROWS ARE RESOLVED ONE PATIENT AT A TIME, WHICH IS A GAP AND NOT A CHOICE
 *
 * `AppointmentResource` carries `patient_id` and no name — correct for a resource that must
 * be safe to hand a patient, and useless on a schedule. There is no bulk read: `GET
 * /v1/patients` accepts a `status` filter and nothing else, so it cannot be asked for a set
 * of ids, and paging the registry to find twenty people is worse than asking for twenty
 * people. So this screen fetches the distinct patients of the day in parallel and tolerates
 * individual failures — a row whose patient could not be read says so and keeps its time,
 * its service and its status, which is still a usable schedule.
 *
 * The fix is an `ids[]` filter on the patient index, or names on the appointment resource
 * for staff readers. It is in the handover notes. Twenty parallel server-side reads is
 * acceptable for a clinic day and would not be for a week view, which is why this component
 * takes a single day and not a range.
 *
 * ------------------------------------------------------------------------------------
 * DEGRADES TO A NOTICE, NEVER TO AN ERROR BOUNDARY
 *
 * A day whose appointment call failed still shows the date, the way to the other days and
 * the way to book. Throwing would replace all of that with the framework's error page, which
 * tells a clinician nothing and looks like the clinic's software is broken.
 */

export type DayViewProps = {
  staff: Staff
  paths: SchedulePaths
  /** `?day=`. Anything unparseable becomes today. */
  day?: string | undefined
  /** `?clinician=`. Absent means the whole clinic. */
  clinicianId?: string | undefined
  /** `?problem=` and `?message=`, handed back by the actions below. */
  problem?: string | undefined
  message?: string | undefined
  /** `?done=` — a reference or a word, echoed after a successful write. */
  done?: string | undefined
}

export async function DayView({
  staff,
  paths,
  day,
  clinicianId,
  problem,
  message,
  done,
}: DayViewProps) {
  const chosenDay = dayOrToday(day)
  const isClinician = staff.roles.includes('clinician')
  const isAdministrator = staff.roles.includes('clinic_admin')

  const [appointments, clinicians, services] = await Promise.all([
    attempt(
      listAppointments({
        from: chosenDay,
        to: chosenDay,
        clinicianId: clinicianId === '' ? undefined : clinicianId,
      }),
    ),
    attempt(listClinicians()),
    attempt(listServices()),
  ])

  const rows = appointments.ok ? appointments.value.data : []
  const patients = await resolvePatients(rows)

  /*
   * Bound to the day being viewed rather than to anything the form posts. An action that
   * took its redirect target from the request is an action that can be told where to send
   * somebody, and the one thing an action must never do is that.
   */
  const back = (params: Record<string, string | undefined> = {}) =>
    href(paths.day, { day: chosenDay, clinician: clinicianId, ...params })

  async function cancel(formData: FormData) {
    'use server'

    const id = String(formData.get('appointment_id') ?? '').trim()
    const reason = String(formData.get('reason') ?? '').trim()

    if (id === '' || reason.length < 3) {
      return redirect(back({ problem: 'incomplete' }))
    }

    const outcome = await cancelAppointment(id, reason)

    if (outcome.kind === 'problem') {
      return redirect(back({ problem: 'failed', message: outcome.message ?? undefined }))
    }

    return redirect(back({ done: `Cancelled ${outcome.appointment.reference}` }))
  }

  async function confirm(formData: FormData) {
    'use server'

    const id = String(formData.get('appointment_id') ?? '').trim()

    /*
     * The typed word is checked HERE, on the server, and not only by the `pattern`
     * attribute. An attribute is a hint to a browser; a member of staff with the developer
     * tools open, or a form posted without a browser at all, does not see it. Confirming an
     * unpaid booking is an audited financial assertion and deserves a real gate.
     */
    if (id === '' || String(formData.get('vouch') ?? '').trim().toUpperCase() !== 'CONFIRM') {
      return redirect(back({ problem: 'incomplete' }))
    }

    const outcome = await confirmDeferred(id)

    if (outcome.kind === 'problem') {
      return redirect(back({ problem: 'failed', message: outcome.message ?? undefined }))
    }

    return redirect(back({ done: `Confirmed ${outcome.appointment.reference}` }))
  }

  const occupied = rows.filter((row) => {
    const status = asStatus(row.status)

    return status !== null && occupiesSlot(status)
  })

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{isToday(chosenDay) ? 'Today' : readableDay(chosenDay)}</h1>
          <p>
            {isToday(chosenDay) ? `${readableDay(chosenDay)} · ` : null}
            {occupied.length === 1
              ? '1 appointment holding time'
              : `${occupied.length} appointments holding time`}
            {rows.length !== occupied.length ? ` · ${rows.length - occupied.length} closed` : null}
          </p>
        </div>

        <Button variant="primary" href={href(paths.book, { day: chosenDay, clinician: clinicianId })}>
          <Icon name="calendar" /> Book for a caller
        </Button>
      </div>

      <div className="grid" style={{ gap: 'var(--space-5)' }}>
        <Outcome problem={problem} message={message} done={done} />

        <DayNavigation
          paths={paths}
          day={chosenDay}
          clinicianId={clinicianId}
          clinicians={clinicians.ok ? clinicians.value : []}
        />

        {!appointments.ok ? (
          <Notice tone="bad" title="The schedule could not be loaded">
            {appointments.message
              ?? 'The request did not reach the clinic’s server. The day below is empty '
                + 'because nothing was read, not because nothing is booked — reload before '
                + 'telling anyone their appointment is missing.'}
          </Notice>
        ) : null}

        {appointments.ok && rows.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="Nothing booked for this day"
            action={
              <Button variant="primary" href={href(paths.book, { day: chosenDay, clinician: clinicianId })}>
                Book for a caller
              </Button>
            }
          >
            An empty day here means no appointment starts on {readableDay(chosenDay)} for the
            clinician selected. It does not mean the clinic is closed.
          </EmptyState>
        ) : null}

        {rows.map((appointment) => (
          <AppointmentRow
            key={appointment.id}
            appointment={appointment}
            patient={patients.get(appointment.patient_id) ?? null}
            service={services.ok ? byId<Service>(services.value, appointment.service_id) : null}
            clinician={clinicians.ok ? byId<Clinician>(clinicians.value, appointment.clinician_id) : null}
            paths={paths}
            isClinician={isClinician}
            isAdministrator={isAdministrator}
            cancelAction={cancel}
            confirmAction={confirm}
          />
        ))}

        {/*
          * Freshness only. Everything above is already rendered; this notices that the day
          * moved underneath it and asks the SERVER to render it again. It is the last thing
          * on the page because it is the least important thing on it — see DayLive.
          */}
        <DayLive
          day={chosenDay}
          clinicianId={clinicianId ?? null}
          signature={signatureOf(rows)}
        />
      </div>
    </>
  )
}

/**
 * The distinct patients of this day, resolved in parallel, failures tolerated.
 *
 * A `Map` rather than a list because the rows look up by id and a linear scan per row over a
 * hundred-appointment day is a hundred scans for no reason.
 *
 * `Promise.allSettled` and not `all`: one unreadable patient — merged, or a race with a
 * registration being edited — must not blank the entire schedule.
 */
async function resolvePatients(rows: readonly Appointment[]): Promise<Map<string, Patient>> {
  const ids = [...new Set(rows.map((row) => row.patient_id))]
  const results = await Promise.allSettled(ids.map((id) => getPatient(id)))
  const resolved = new Map<string, Patient>()

  for (const result of results) {
    if (result.status === 'fulfilled') {
      resolved.set(result.value.id, result.value)
    }
  }

  return resolved
}

/**
 * Everything about the day that would make it render differently, as one short string.
 *
 * NOT THE APPOINTMENTS. This is what the live check compares, and it is deliberately a
 * signature — @carevelo/realtime's rule, that a frame is a hint to re-fetch and never the
 * thing itself, applies exactly as well to a poll. Nothing clinical is in it: identifiers and
 * states, which is precisely what a broadcast frame is allowed to carry.
 */
export function signatureOf(rows: readonly Appointment[]): string {
  return rows.map((row) => `${row.id}:${row.status}`).join(',')
}

/** Yesterday, today, tomorrow, and which clinician. Three anchors and one GET form. */
function DayNavigation({
  paths,
  day,
  clinicianId,
  clinicians,
}: {
  paths: SchedulePaths
  day: string
  clinicianId: string | undefined
  clinicians: readonly Clinician[]
}) {
  return (
    <div className="card row-wrap between" style={{ gap: 'var(--space-5)' }}>
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <Button variant="quiet" href={href(paths.day, { day: shiftDay(day, -1), clinician: clinicianId })}>
          <Icon name="chevLeft" className="ico" /> Previous
        </Button>
        <Button variant="quiet" href={href(paths.day, { day: today(), clinician: clinicianId })}>
          Today
        </Button>
        <Button variant="quiet" href={href(paths.day, { day: shiftDay(day, 1), clinician: clinicianId })}>
          Next <Icon name="chevRight" className="ico" />
        </Button>
      </div>

      {/*
        * A GET form, so the result is a URL. Submitting navigates; the day travels in a
        * hidden field so choosing a clinician does not silently throw you back to today.
        *
        * The submit button is not optional and is not a fallback for "no JavaScript". There
        * is no onChange handler anywhere in this console; a select that only works once a
        * bundle has arrived is a select that does nothing in a corridor.
        */}
      <form method="get" action={paths.day} className="row" style={{ gap: 'var(--space-3)' }}>
        <input type="hidden" name="day" value={day} />

        <label className="field__label" htmlFor="clinician-filter">
          Clinician
        </label>
        <Select id="clinician-filter" name="clinician" defaultValue={clinicianId ?? ''}>
          <option value="">Everyone</option>
          {clinicians.map((clinician) => (
            <option key={clinician.id} value={clinician.id}>
              {clinician.name}
            </option>
          ))}
        </Select>

        <Button variant="quiet" type="submit">
          Show
        </Button>
      </form>
    </div>
  )
}

/**
 * What the last action did, if anything.
 *
 * `message` IS THE API'S OWN SENTENCE and arrives through the query string, which is written
 * by whoever sends the link. It is rendered as TEXT inside a notice and never as markup, and
 * the codes are a closed set — so the worst a crafted URL achieves is a stranger's sentence
 * in a box, which is why `problem` and `message` are separate parameters and only the first
 * decides the shape of the response.
 */
function Outcome({
  problem,
  message,
  done,
}: {
  problem: string | undefined
  message: string | undefined
  done: string | undefined
}) {
  if (done !== undefined && done !== '') {
    return <Notice tone="info" icon="check" title="Done">{done}</Notice>
  }

  if (problem === undefined || problem === '') {
    return null
  }

  if (problem === 'incomplete') {
    return (
      <Notice tone="warn" title="Nothing was changed">
        The form was submitted without everything it needs. Nothing has been sent to the
        clinic&rsquo;s record.
      </Notice>
    )
  }

  return (
    <Notice tone="bad" title="That did not go through">
      {message && message !== ''
        ? message
        : 'The clinic’s server refused the change and gave no reason this screen can '
          + 'pass on. Nothing was altered.'}
    </Notice>
  )
}
