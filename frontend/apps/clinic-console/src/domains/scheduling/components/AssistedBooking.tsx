import { redirect } from 'next/navigation'
import {
  Badge,
  Button,
  Choice,
  DateTime,
  EmptyState,
  Field,
  Icon,
  Money,
  Notice,
  Select,
  type ChoiceOption,
} from '@carevelo/ui'
import { attempt, type Staff } from '../api/gateway'
import { bookAppointment } from '../api/appointments'
import { byId, getPatient, listAvailability, listClinicians, listPatients, listServices } from '../api/catalogue'
import { dayOrToday, readableDay, shiftDay, today } from '../model/day'
import { href } from '../model/links'
import {
  bookableModes,
  decodeSlot,
  encodeSlot,
  isConsultationMode,
  isPaymentExpectation,
  MAX_SLOTS_SHOWN,
} from '../model/slots'
import type {
  BookingProblem,
  Clinician,
  ConsultationMode,
  SchedulePaths,
  Service,
  Slot,
} from '../model/types'
import { PatientChooser } from './PatientChooser'

/**
 * FRONT-DESK ASSISTED BOOKING — the primary way appointments are made in year one.
 *
 * ------------------------------------------------------------------------------------
 * THIS IS NOT AN ADMINISTRATIVE FALLBACK BOLTED ON TO THE SIDE OF SELF-SERVICE
 *
 * The PRD is explicit that most bookings in the first year will be made this way: a patient
 * telephones the clinic and a receptionist types while they talk. Everything about the shape
 * of this screen follows from that one fact and from nothing about how a patient books for
 * themselves.
 *
 *   - THE ORDER IS THE ORDER OF THE CONVERSATION. Who is calling, what do they need, with
 *     whom, which day, which time, how will they pay. A screen that asked for the payment
 *     method first would be a screen that interrupts a phone call.
 *   - EVERY STEP IS A URL. Choosing a patient, a service, a clinician or a day is a
 *     navigation, so the browser's back button works, a half-finished booking survives a
 *     dropped connection, and a receptionist can put a caller on hold and come back to it.
 *   - NO STEP NEEDS JAVASCRIPT. Every selector is a `<form method="get">` with a submit
 *     button; the booking itself is a native POST to a server action. The one interactive
 *     thing on the whole console is the day view's refresher, and nothing depends on it.
 *   - KEYBOARD FIRST. The controls are in tab order in the order they are used, the search
 *     box is the first focusable thing on the screen, and there is no control that requires
 *     a pointer.
 *
 * ------------------------------------------------------------------------------------
 * THE SLOT RACE IS NORMAL AND IS NOT AN ERROR
 *
 * Availability is advisory: it is the clinic's working hours minus its busy periods at the
 * instant of asking, and two receptionists can read the same free slot a millisecond apart.
 * `AppointmentController::store` re-checks inside the booking transaction and refuses the
 * loser with a validation error keyed on `scheduled_start_at`. The response to that here is
 * not an apology — it is a fresh list of times with a line saying what happened, because the
 * caller is still on the line and still needs an appointment.
 */

export type AssistedBookingProps = {
  staff: Staff
  paths: SchedulePaths
  /** Everything below is read straight off `searchParams` and validated here. */
  patientId?: string | undefined
  serviceId?: string | undefined
  clinicianId?: string | undefined
  day?: string | undefined
  query?: string | undefined
  problem?: string | undefined
  message?: string | undefined
}

export async function AssistedBooking({
  staff,
  paths,
  patientId,
  serviceId,
  clinicianId,
  day,
  query,
  problem,
  message,
}: AssistedBookingProps) {
  const chosenDay = dayOrToday(day)

  /*
   * The role check is a courtesy, not the control. `AppointmentPolicy::create` delegates to
   * `viewAny`, whose list is administrator, clinician and front desk, and the API is what
   * enforces it. Rendering the form for a pharmacist would produce a 403 at the end of a
   * conversation with a patient, which is the worst possible moment to discover it.
   */
  const mayBook = staff.roles.some((role) =>
    role === 'clinic_admin' || role === 'clinician' || role === 'front_desk',
  )

  if (!mayBook) {
    return (
      <>
        <Head />
        <Notice tone="warn" icon="lock" title="Booking is not part of your role here">
          Appointments are booked by the front desk, a clinician or an administrator. Your
          account holds none of those roles at this clinic, so this screen would refuse the
          booking at the end rather than at the start.
        </Notice>
      </>
    )
  }

  const [registry, services, clinicians] = await Promise.all([
    attempt(listPatients()),
    attempt(listServices()),
    attempt(listClinicians()),
  ])

  const carry = { service: serviceId, clinician: clinicianId, day: chosenDay, q: query }

  if (patientId === undefined || patientId === '') {
    return (
      <>
        <Head />
        <Outcome problem={problem} message={message} />
        {registry.ok ? (
          <PatientChooser
            paths={paths}
            patients={registry.value.patients}
            scanned={registry.value.patients.length}
            truncated={registry.value.nextCursor !== null}
            query={query}
            carry={carry}
          />
        ) : (
          <Notice tone="bad" title="The patient registry could not be read">
            {registry.message ?? 'The request did not reach the clinic’s server.'}
          </Notice>
        )}
      </>
    )
  }

  const patient = await attempt(getPatient(patientId))

  if (!patient.ok) {
    /*
     * A patient id that does not resolve is a 404 whether it never existed or belongs to
     * another clinic, and this screen must not draw the distinction back out. It says the
     * booking cannot proceed and offers the way back, which is the same answer either way.
     */
    return (
      <>
        <Head />
        <EmptyState
          icon="user"
          title="That patient record is not available"
          action={
            <Button variant="primary" href={href(paths.book, { day: chosenDay })}>
              Choose a patient
            </Button>
          }
        >
          The record could not be read. It may have been merged into another, or it may not
          belong to this clinic.
        </EmptyState>
      </>
    )
  }

  /*
   * Pulled out of the `Attempt` before the action below closes over it. TypeScript narrows a
   * discriminated union at the point of the check and forgets that narrowing inside a nested
   * function, which is correct — the closure runs later and the compiler cannot know the
   * variable has not been reassigned. Naming the value is the honest fix; a non-null
   * assertion inside the action would be the same thing with the check removed.
   */
  const record = patient.value
  const service = services.ok ? byId<Service>(services.value, serviceId) : null

  const availability =
    service === null
      ? null
      : await attempt(
          listAvailability({
            serviceId: service.id,
            clinicianId: clinicianId === '' ? undefined : clinicianId,
            from: chosenDay,
            to: chosenDay,
          }),
        )

  const slots: Slot[] = availability?.ok ? availability.value.slots : []
  const shown = slots.slice(0, MAX_SLOTS_SHOWN)

  const back = (params: Record<string, string | undefined>) =>
    href(paths.book, {
      patient: patientId,
      service: serviceId,
      clinician: clinicianId,
      day: chosenDay,
      ...params,
    })

  /**
   * Book it.
   *
   * NOTHING THAT ARRIVES IN THE FORM IS TRUSTED, and nothing that matters comes from it. The
   * patient, the service and the day are closed over from what the SERVER rendered; only the
   * slot, the mode and the payment expectation are read from the post, and each is narrowed
   * before it is used. Every fact about the world — does this clinician exist, is the clinic
   * open then, is the slot still free — is settled by the API inside the booking transaction,
   * which is the only place it can be settled correctly.
   */
  async function book(formData: FormData) {
    'use server'

    if (service === null) {
      return redirect(back({ problem: 'incomplete' }))
    }

    const slot = decodeSlot(String(formData.get('slot') ?? ''))
    const mode = String(formData.get('mode') ?? '')
    const expectation = String(formData.get('payment_expectation') ?? '')

    if (slot === null || !isConsultationMode(mode) || !isPaymentExpectation(expectation)) {
      return redirect(back({ problem: 'incomplete' }))
    }

    const outcome = await bookAppointment({
      patientId: record.id,
      clinicianId: slot.clinicianId,
      serviceId: service.id,
      startsAt: slot.startsAt,
      mode,
      paymentExpectation: expectation,
    })

    if (outcome.kind === 'problem') {
      return redirect(back({ problem: outcome.problem, message: outcome.message ?? undefined }))
    }

    // Straight to the day the appointment is on, not back to this form. The receptionist's
    // next question is "is it on the board?", and the answer is the board.
    return redirect(
      href(paths.day, {
        day: chosenDay,
        clinician: slot.clinicianId,
        done: `Booked ${outcome.appointment.reference} for ${record.given_name} ${record.family_name}`,
      }),
    )
  }

  const modes = service === null ? [] : bookableModes(service.modes)

  const modeOptions: ChoiceOption[] = modes.map((mode) => ({
    value: mode,
    label: MODE_LABEL[mode],
    note: MODE_NOTE[mode],
  }))

  return (
    <>
      <Head />
      <Outcome problem={problem} message={message} />

      <div className="grid" style={{ gap: 'var(--space-5)' }}>
        <div className="card row-wrap between" style={{ gap: 'var(--space-4)' }}>
          <div className="stack">
            <span className="eyebrow">Booking for</span>
            <span style={{ fontWeight: 650, fontSize: 17 }}>
              {record.given_name} {record.family_name}
            </span>
            <span className="fine tnum">{record.phone}</span>
            {record.status !== 'active' ? (
              <Badge tone="warn">{record.status.replace(/_/g, ' ')}</Badge>
            ) : null}
          </div>

          <Button variant="quiet" href={href(paths.book, { day: chosenDay })}>
            Someone else
          </Button>
        </div>

        {/*
          * ONE FORM FOR THE THREE FILTERS, submitted with a button. Service, clinician and day
          * are one question — "what are we looking for times for?" — and splitting them into
          * three forms would make a receptionist submit three times to change a booking from
          * Tuesday to Wednesday with a different doctor.
          */}
        <form method="get" action={paths.book} className="card grid g-3" style={{ gap: 'var(--space-5)' }}>
          <input type="hidden" name="patient" value={patientId} />
          {query ? <input type="hidden" name="q" value={query} /> : null}

          <Field name="service" label="Service">
            {(control) => (
              <Select {...control} defaultValue={serviceId ?? ''} required>
                <option value="">Choose a service…</option>
                {(services.ok ? services.value : [])
                  .filter((offering) => offering.is_active)
                  .map((offering) => (
                    <option key={offering.id} value={offering.id}>
                      {offering.name} · {offering.duration_minutes} min
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <Field
            name="clinician"
            label="Clinician"
            hint="Leave as anyone if the caller has no preference — it usually finds an earlier time."
          >
            {(control) => (
              <Select {...control} defaultValue={clinicianId ?? ''}>
                <option value="">Anyone</option>
                {(clinicians.ok ? clinicians.value : []).map((person: Clinician) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field name="day" label="Day">
            {(control) => (
              <Select {...control} defaultValue={chosenDay}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((offset) => {
                  const value = shiftDay(today(), offset)

                  return (
                    <option key={value} value={value}>
                      {readableDay(value)}
                    </option>
                  )
                })}
              </Select>
            )}
          </Field>

          <div>
            <Button variant="primary" type="submit">
              <Icon name="clock" /> Show times
            </Button>
          </div>
        </form>

        {service === null ? (
          <Notice tone="info" icon="calendar" title="Choose a service to see times" announce={false}>
            Availability is generated per service, because the service is where the clinic
            keeps the length of the appointment. There is no general list of free times.
          </Notice>
        ) : null}

        {service !== null && availability !== null && !availability.ok ? (
          <Notice tone="bad" title="Times could not be loaded">
            {availability.message
              ?? 'The request did not reach the clinic’s server. No times are shown because '
                + 'none were read, not because the day is full.'}
          </Notice>
        ) : null}

        {service !== null && availability?.ok && slots.length === 0 ? (
          <EmptyState icon="clock" title="No free times on this day">
            The clinic&rsquo;s working hours for {readableDay(chosenDay)} are either closed or
            fully taken for this service. Try the next day, or leave the clinician as anyone.
          </EmptyState>
        ) : null}

        {service !== null && shown.length > 0 ? (
          <form action={book} className="card stack" style={{ gap: 'var(--space-6)' }}>
            <div className="stack">
              <h2 className="title">{service.name}</h2>
              <p className="muted">
                {service.duration_minutes} minutes ·{' '}
                <Money value={{ amount_minor: service.price.amount_minor, currency: service.price.currency }} />
              </p>
            </div>

            <SlotPicker
              slots={shown}
              total={slots.length}
              clinicians={clinicians.ok ? clinicians.value : []}
            />

            <Choice
              name="mode"
              legend="How will this consultation be held?"
              options={modeOptions}
              required
              defaultValue={modes[0]}
              hint="Ask the caller. Voice and chat are proper choices for someone who knows their connection will not carry video — booking video and hoping is how a consultation is wasted."
            />

            <Choice
              name="payment_expectation"
              legend="How will the patient pay?"
              required
              defaultValue="pay_at_clinic"
              options={[
                {
                  value: 'pay_at_clinic',
                  label: 'At the clinic',
                  note: 'The appointment is confirmed immediately. Cash is attested at the desk on the day.',
                },
                {
                  value: 'prepaid',
                  label: 'By mobile money, before the appointment',
                  note:
                    'The slot is HELD, not booked, and released automatically if payment does '
                    + 'not arrive. A caller who is not at their handset now will usually lose it.',
                },
              ]}
              hint="Carevelo never holds the clinic’s money. Either way the payment is between the patient and the clinic; this only records what to expect."
            />

            <div>
              <Button variant="primary" size="lg" type="submit">
                <Icon name="check" /> Book this appointment
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </>
  )
}

function Head() {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>Book for a caller</h1>
        <p>
          Most appointments are made this way. Work down the screen in the order of the
          conversation; every step is a page you can go back to.
        </p>
      </div>
    </div>
  )
}

/**
 * The times, as radios.
 *
 * RADIOS AND NOT BUTTONS, because a radio group is one control with one value and a screen
 * reader announces "3 of 24" as you move through it. Twenty-four separate submit buttons
 * announce twenty-four separate things and post on the first press, which is how a
 * receptionist books 09:00 while reaching for 09:30.
 */
function SlotPicker({
  slots,
  total,
  clinicians,
}: {
  slots: readonly Slot[]
  total: number
  clinicians: readonly Clinician[]
}) {
  return (
    <fieldset className="stack" style={{ gap: 'var(--space-4)' }}>
      <legend className="field__label">Times</legend>

      <div className="grid g-4" style={{ gap: 'var(--space-3)' }}>
        {slots.map((slot) => {
          const value = encodeSlot(slot)
          const clinician = clinicians.find((person) => person.id === slot.clinician_id)

          return (
            <label
              key={value}
              className="choice__option"
              style={{ minHeight: 'var(--touch-min)' }}
            >
              <input className="choice__input" type="radio" name="slot" value={value} required />
              <span className="choice__text">
                <span className="tnum">
                  <DateTime value={slot.starts_at} format="time" />
                </span>
                {/* The clinician's name, because "anyone" was a real option above and a
                    receptionist has to be able to tell the caller who they will see. */}
                <span className="choice__note">{clinician?.name ?? 'Clinician'}</span>
              </span>
            </label>
          )
        })}
      </div>

      {total > slots.length ? (
        <p className="fine">
          Showing the first {slots.length} of {total} free times. Narrow by clinician, or pick
          another day, to reach the rest.
        </p>
      ) : null}

      <p className="fine">
        Times are the clinic&rsquo;s working hours minus what is already taken, read a moment
        ago. Another desk can take one of these while you are on the call — if that happens the
        booking is refused and this list comes back fresh.
      </p>
    </fieldset>
  )
}

const MODE_LABEL: Record<ConsultationMode, string> = {
  in_person: 'In person, at the clinic',
  video: 'Video',
  voice: 'Voice call',
  chat: 'Chat',
}

const MODE_NOTE: Record<ConsultationMode, string> = {
  in_person: 'The patient comes to the clinic.',
  video: 'Needs a usable data connection at both ends.',
  voice: 'Works on any handset and on a weak connection.',
  chat: 'Text only. Useful where a call is not private or not affordable.',
}

/** What the last attempt did. See the identical note on the day view: codes, never markup. */
function Outcome({ problem, message }: { problem: string | undefined; message: string | undefined }) {
  if (problem === undefined || problem === '') {
    return null
  }

  const known = problem as BookingProblem

  if (known === 'slot_taken') {
    return (
      <Notice tone="warn" icon="clock" title="That time went while you were on the call">
        Another desk booked it first. Nothing was created and the patient has not been charged.
        Pick another time below — the list has been refreshed.
      </Notice>
    )
  }

  if (known === 'refused') {
    return (
      <Notice tone="warn" icon="lock" title="The clinic’s server refused the booking">
        Your account does not hold a role that may book at this clinic. An administrator can
        change that on the settings screen.
      </Notice>
    )
  }

  if (known === 'incomplete') {
    return (
      <Notice tone="warn" title="Nothing was booked">
        The form was submitted without a time, a mode or a payment expectation. Nothing has
        been created.
      </Notice>
    )
  }

  return (
    <Notice tone="bad" title="The booking did not go through">
      {message && message !== ''
        ? message
        : 'The clinic’s server refused it and gave no reason this screen can pass on. '
          + 'Nothing was created — check the day view before booking again.'}
    </Notice>
  )
}
