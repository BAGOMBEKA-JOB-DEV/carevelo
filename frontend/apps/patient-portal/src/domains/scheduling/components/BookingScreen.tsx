import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import {
  Button,
  Card,
  Choice,
  EmptyState,
  Field,
  Icon,
  Money,
  Inline,
  Notice,
  Select,
  Stack,
  formatInstant,
  type ChoiceOption,
} from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { bookAppointment } from '../api/appointments'
import { listAvailability } from '../api/availability'
import { byId, listClinicians, listServices } from '../api/catalogue'
import { attempt } from '../api/http'
import { availabilityWindow, isCalendarDate, middayOn, windowDays } from '../model/calendar'
import { UNPAID_HOLD_MINUTES } from '../model/hold'
import { href } from '../model/links'
import {
  MAX_SLOTS_SHOWN,
  bookableModes,
  decodeSlot,
  encodeSlot,
  isConsultationMode,
} from '../model/slots'
import type { BookingProblem, SchedulingPaths } from '../model/types'
import { modeText } from './strings'
import { PageBody } from '@/components/PageBody'
import { SitePageHeader } from '@/components/SitePageHeader'

/**
 * CHOOSE AND BOOK: one service, one mode, one time, one way of paying.
 *
 * ------------------------------------------------------------
 * IT POSTS NATIVELY, AND EVERY DECISION BELOW FOLLOWS FROM THAT
 *
 * Two plain forms and no `'use client'`. The first is a GET that narrows the times — a
 * clinician, a day — and the second is a POST to a Server Action that books. Neither
 * needs JavaScript to have arrived, which is the binding constraint: the patient this is
 * built for is holding a mid-range Android on variable mobile data, and a booking form
 * that waits for a bundle is a booking form that fails at the moment somebody needs care.
 *
 * That is also why the slot picker is a radio group rather than a calendar widget, why
 * changing clinician is a submit button rather than an onChange, and why the chosen slot
 * travels as one encoded string — see model/slots.ts. Each of those has a nicer version
 * that only works with JavaScript.
 *
 * ------------------------------------------------------------
 * A SLOT TAKEN WHILE THE PATIENT WAS READING IS A NORMAL OUTCOME
 *
 * `AvailabilityController` is explicit that its answer is ADVISORY: it narrows the race
 * between two patients reading the same free slot, and booking decides it inside a
 * transaction. So the interesting case is not the error case — it is this one, and it
 * gets a warning, an apology-free sentence and a freshly-loaded list of times. Not an
 * error page: nothing has gone wrong, somebody else was quicker.
 *
 * ------------------------------------------------------------
 * THE FOUR MODES ARE PEERS
 *
 * `docs/10-product/prd-h3-teleconsultation.md` §1 is explicit, and it is a product
 * decision rather than a preference: a patient on a poor connection must be able to
 * CHOOSE voice deliberately rather than fight a failing video call. So all four sit in
 * one radio group, in the enum's own order, each with a line saying what it is and what
 * it costs in data. None is marked as a fallback and none is hidden.
 *
 * ------------------------------------------------------------
 * WHETHER "PAY NOW" IS OFFERED IS NOT THIS SCREEN'S TO GUESS
 *
 * §H1.6: a tenant with no payment aggregator configured can only offer pay-at-clinic. The
 * flag that says so — `AggregatorAccountResource.accepts_online_payment` — lives on an
 * ADMINISTRATOR-ONLY endpoint, so a patient's session cannot read it and this component
 * cannot ask. It is therefore a required-by-omission prop, defaulting to FALSE: the safe
 * direction is to offer only what certainly works, because a booking made prepaid with
 * nowhere to pay holds a slot for fifteen minutes and then expires.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md
 */

export type BookingScreenProps = {
  tenant: Tenant
  /**
   * The patient RECORD this booking is for — not the user id.
   *
   * A CLOSURE VARIABLE, NEVER A HIDDEN INPUT. Next encrypts the variables an inline
   * Server Action closes over, so the identifier cannot be edited in a form and posted
   * back as somebody else's. That matters more than usual here: `AppointmentPolicy`
   * checks that the CALLER may book, and does not check that the `patient_id` in the body
   * is one they own — the endpoint is written for a front desk booking on behalf of
   * anyone who telephones. See the report accompanying this domain.
   */
  patientId: string
  paths: SchedulingPaths
  /** `?service=` — which service is being booked. Absent means nothing has been chosen. */
  serviceId?: string | undefined
  /** `?clinician=` — empty or absent means anyone available. */
  clinicianId?: string | undefined
  /** `?day=` — a `YYYY-MM-DD` in the clinic's timezone, or absent for the whole window. */
  day?: string | undefined
  /** Whether the clinic can take money through the portal at all. See the note above. */
  onlinePaymentAvailable?: boolean | undefined
  /** `?problem=` — what the last attempt did. See `BookingProblem`. */
  problem?: string | undefined
  /** `?message=` — the API's own sentence, where it gave one worth repeating. */
  message?: string | undefined
}

export async function BookingScreen({
  tenant,
  patientId,
  paths,
  serviceId,
  clinicianId,
  day,
  onlinePaymentAvailable = false,
  problem,
  message,
}: BookingScreenProps) {
  const [t, common, modes] = await Promise.all([
    getTranslations('Scheduling'),
    getTranslations('Common'),
    modeText(),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')
  const phone = tenant.contact?.phone

  // A `<select>` with nothing chosen posts an EMPTY STRING, not an absent parameter, so
  // both have to mean "anyone" and "any day". Normalised once, here, rather than at four
  // call sites that would each have to remember.
  const clinician = clinicianId !== undefined && clinicianId !== '' ? clinicianId : undefined
  const chosenDay = isCalendarDate(day) ? day : undefined

  const back = (
    <Button variant="quiet" href={paths.browse}>
      {t('booking.back')}
    </Button>
  )

  if (serviceId === undefined || serviceId === '') {
    return (
      <Frame eyebrow={t('booking.eyebrow')} title={t('booking.noServiceTitle')} action={back}>
        <EmptyState
          icon="calendar"
          title={t('booking.noServiceTitle')}
          action={
            <Button variant="brand" href={paths.browse}>
              {t('booking.back')}
            </Button>
          }
        >
          {t('booking.noServiceBody', { clinic })}
        </EmptyState>
      </Frame>
    )
  }

  const catalogue = await attempt(Promise.all([listServices(), listClinicians()]))

  if (!catalogue.ok) {
    return (
      <Frame eyebrow={t('booking.eyebrow')} title={t('catalogue.unavailableTitle')} action={back}>
        <Notice tone="bad" title={t('catalogue.unavailableTitle')}>
          {catalogue.message ?? t('catalogue.unavailableGeneric', { clinic })}{' '}
          {t('catalogue.unavailableBody')}
        </Notice>
      </Frame>
    )
  }

  const [services, clinicians] = catalogue.value
  const service = services.find((candidate) => candidate.id === serviceId)

  if (service === undefined) {
    /* Either the clinic withdrew it, or the id was never theirs. The same page for both,
       deliberately: which of the two it was is the clinic's information, not a stranger's,
       and the distinction is exactly what an enumeration attempt is looking for. */
    return (
      <Frame eyebrow={t('booking.eyebrow')} title={t('booking.withdrawnTitle')} action={back}>
        <EmptyState
          icon="help"
          title={t('booking.withdrawnTitle')}
          action={
            <Button variant="brand" href={paths.browse}>
              {t('booking.back')}
            </Button>
          }
        >
          {t('booking.withdrawnBody', { clinic })}
        </EmptyState>
      </Frame>
    )
  }

  /*
   * Narrowed once, into a const the Server Action below can close over.
   *
   * A hoisted function declaration does not inherit the narrowing above it — TypeScript
   * has to assume it could be called before the check runs — so `service` reads as
   * possibly-undefined inside the action however obviously it is not. The alias is the
   * fix, and it is worth the two lines: the alternative is a non-null assertion inside a
   * function that books a real appointment.
   */
  const chosen = service

  const window = availabilityWindow(tenant.timezone, chosenDay)
  const availability = await attempt(
    listAvailability({
      serviceId: service.id,
      clinicianId: clinician,
      from: window.from,
      to: window.to,
    }),
  )

  const slots = availability.ok ? availability.value.slots : []
  const shown = slots.slice(0, MAX_SLOTS_SHOWN)
  const clinicianById = byId(clinicians)

  // Only worth naming a clinician on each row when the patient has not already narrowed
  // to one — otherwise every row repeats the same name for no information.
  const nameTheClinician = clinician === undefined && clinicians.length > 1

  const slotOptions: ChoiceOption[] = shown.map((slot) => {
    const name = clinicianById.get(slot.clinician_id)?.name

    return {
      value: encodeSlot(slot),
      // Date AND time on every row. A list showing only times invites a patient scrolling
      // past a day boundary to book the right hour on the wrong day.
      label: `${formatInstant(slot.starts_at, 'date')}, ${formatInstant(
        slot.starts_at,
        'time',
      )}–${formatInstant(slot.ends_at, 'time')}`,
      note:
        nameTheClinician && name ? t('booking.slotClinician', { clinician: name }) : undefined,
    }
  })

  const offered = bookableModes(service.modes)
  const modeOptions: ChoiceOption[] = offered.map((mode) => ({
    value: mode,
    label: modes[mode].label,
    note: modes[mode].note,
  }))

  /*
   * Prepaid needs BOTH a clinic that can take money and a screen that collects it. The
   * payments domain owns the second, and its absence from `paths` is how the route layer
   * says it is not mounted — at which point offering "pay now" would book a slot the
   * patient cannot pay for and watch it expire fifteen minutes later.
   */
  const allowPrepaid = onlinePaymentAvailable && paths.payment !== undefined

  async function confirmBooking(formData: FormData) {
    'use server'

    const again = (reason: BookingProblem, detail?: string) =>
      href(paths.book, {
        service: chosen.id,
        clinician,
        day: chosenDay,
        problem: reason,
        message: detail,
      })

    // Everything that arrives through a form is the patient's to edit, so nothing here is
    // trusted: the shape is checked, and every fact about the world — does this clinician
    // exist, is the clinic open then, is the slot still free — is settled by the API
    // inside the booking transaction, which is the only place it can be settled correctly.
    const slot = decodeSlot(String(formData.get('slot') ?? ''))
    const mode = String(formData.get('mode') ?? '')

    if (slot === null || !isConsultationMode(mode)) {
      return redirect(again('incomplete'))
    }

    const outcome = await bookAppointment({
      patientId,
      clinicianId: slot.clinicianId,
      serviceId: chosen.id,
      startsAt: slot.startsAt,
      mode,
      // Clamped against the closure rather than trusted from the body. A form that posts
      // `prepaid` to a clinic with no way to take it would create a booking that can only
      // expire, so the flag that decides it is the one the server rendered with.
      paymentExpectation:
        allowPrepaid && String(formData.get('payment_expectation') ?? '') === 'prepaid'
          ? 'prepaid'
          : 'pay_at_clinic',
    })

    if (outcome.kind === 'problem') {
      return redirect(again(outcome.problem, outcome.message ?? undefined))
    }

    // A prepaid booking is holding a slot on a fifteen-minute clock from this instant, so
    // the patient goes straight to paying rather than to a list where they might not
    // notice. Everything else is already confirmed.
    if (outcome.appointment.status === 'awaiting_payment' && paths.payment !== undefined) {
      return redirect(href(paths.payment, { appointment: outcome.appointment.id }))
    }

    return redirect(href(paths.appointments, { booked: outcome.appointment.reference }))
  }

  return (
    <Frame
      eyebrow={t('booking.eyebrow')}
      title={t('booking.title', { service: service.name })}
      action={back}
    >
      {/* The clinic speaking about its own service, in the clinic's own tint. ONE brand
          card on the screen — a page of tinted cards is a page with no emphasis left. */}
      <Card tone="brand" as="section" aria-labelledby="booking-service">
        <Stack gap="4">
          {/* SURVIVING INLINE STYLES on this card, three of them, all the same shortfall:
              there is no 19px heading step and no small `.stat__value` on the scale. 28px
              is `.stat__value`'s size because it was written for a COUNT; "UGX 30,000" and
              "30 minutes" at 28px in the display face wrap inside a half-width stat on a
              phone. The two or three modifier classes that retire these belong in
              tokens/components.css, beside the rules they modify and shared with the
              console's matching overrides — see the note in src/app/account/page.tsx. */}
          <h2 id="booking-service" style={{ fontSize: 19, fontWeight: 650 }}>
            {service.name}
          </h2>

          {/* `.muted` and no size: the 14.5px this used to state IS `--text-base-size`,
              which the `<p>` inherits from `body` regardless. */}
          {service.description ? <p className="muted">{service.description}</p> : null}

          <Inline gap="7">
            <span className="stat">
              <span className="stat__label">{t('booking.priceLabel')}</span>
              <span className="stat__value" style={{ fontSize: 22 }}>
                <Money value={service.price} />
              </span>
            </span>

            <span className="stat">
              <span className="stat__label">{t('booking.durationLabel')}</span>
              <span className="stat__value" style={{ fontSize: 22 }}>
                {t('catalogue.duration', { minutes: service.duration_minutes })}
              </span>
            </span>
          </Inline>
        </Stack>
      </Card>

      {problem === 'slot_taken' ? (
        <Notice tone="warn" icon="clock" title={t('booking.slotTakenTitle')}>
          {t('booking.slotTakenBody')}
        </Notice>
      ) : null}

      {problem === 'refused' ? (
        /* A 403 on booking. The honest response is the clinic's telephone number rather
           than "something went wrong": front desk books on a patient's behalf all day and
           the PRD expects most first-year bookings to be made that way. */
        <Notice tone="warn" icon="phone" title={t('booking.refusedTitle')}>
          {phone
            ? t('booking.refusedBodyWithPhone', { clinic, phone })
            : t('booking.refusedBody', { clinic })}
        </Notice>
      ) : null}

      {problem === 'incomplete' ? (
        <Notice tone="warn" title={t('booking.incompleteTitle')}>
          {t('booking.incompleteBody')}
        </Notice>
      ) : null}

      {problem === 'invalid' || problem === 'failed' ? (
        <Notice tone="bad" title={t('booking.failedTitle')}>
          {message ?? t('booking.failedBody')}
        </Notice>
      ) : null}

      {/* ---- Narrowing the times. A GET, so the result is a URL the patient can go back
              to, reload, or send to somebody. ---- */}
      <Card as="section" aria-labelledby="booking-narrow">
        <form method="get" action={paths.book}>
          {/* The column lives INSIDE the form rather than on it: `Stack` renders a `div`
              and there is no `as="form"`, deliberately — a layout primitive that could
              become a form is one that can silently change what a submit does. A block
              `<form>` wrapping a full-width Stack lays out identically, because every
              child was already a flex item of the same column. */}
          <Stack gap="5">
            <span className="field__label" id="booking-narrow">
              {t('booking.narrowLegend')}
            </span>

            {/* A GET form replaces the query string entirely, so the service has to be
                carried across or the submit would lose what is being booked. */}
            <input type="hidden" name="service" value={service.id} />

            <Field name="clinician" label={t('booking.clinicianLabel')}>
              {(control) => (
                <Select {...control} defaultValue={clinician ?? ''}>
                  <option value="">{t('booking.anyClinician')}</option>
                  {clinicians.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.specialty
                        ? `${candidate.name} — ${candidate.specialty}`
                        : candidate.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field name="day" label={t('booking.dayLabel')}>
              {(control) => (
                <Select {...control} defaultValue={chosenDay ?? ''}>
                  <option value="">{t('booking.anyDay')}</option>
                  {windowDays(tenant.timezone).map((date) => (
                    <option key={date} value={date}>
                      {formatInstant(middayOn(date), 'date')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Button type="submit" variant="quiet">
              <Icon name="clock" /> {t('booking.showTimes')}
            </Button>
          </Stack>
        </form>
      </Card>

      {!availability.ok ? (
        <Notice tone="bad" title={t('catalogue.unavailableTitle')}>
          {availability.message ?? t('catalogue.unavailableGeneric', { clinic })}{' '}
          {t('catalogue.unavailableBody')}
        </Notice>
      ) : shown.length === 0 ? (
        <EmptyState icon="calendar" title={t('booking.noSlotsTitle')}>
          {t('booking.noSlotsBody', { anyClinician: t('booking.anyClinician') })}
        </EmptyState>
      ) : (
        <form action={confirmBooking}>
          {/* Same shape as the GET form above: the column is a Stack inside the form,
              because `Stack` renders a `div` and never a `form`. */}
          <Stack gap="7">
            <Choice
              name="mode"
              legend={t('booking.modeLegend')}
              hint={t('booking.modeHint')}
              options={modeOptions}
              required
              // Pre-selected only when the clinic offers exactly one way to have this
              // service, where a "choice" of one is a tap that asks nothing.
              defaultValue={modeOptions.length === 1 ? modeOptions[0]?.value : undefined}
            />

            <Choice
              name="slot"
              legend={t('booking.slotLegend')}
              hint={t('booking.slotHint')}
              options={slotOptions}
              required
            />

            {slots.length > shown.length ? (
              <Notice tone="info" icon="help">
                {t('booking.truncated', { count: shown.length })}
              </Notice>
            ) : null}

            {allowPrepaid ? (
              <Choice
                name="payment_expectation"
                legend={t('booking.paymentLegend')}
                required
                options={[
                  {
                    value: 'prepaid',
                    label: t('booking.payNowLabel'),
                    note: t('booking.payNowNote', { minutes: UNPAID_HOLD_MINUTES }),
                  },
                  {
                    value: 'pay_at_clinic',
                    label: t('booking.payAtClinicLabel'),
                    note: t('booking.payAtClinicNote', { clinic }),
                  },
                ]}
              />
            ) : (
              /* Not a radio group of one. Where there is no decision to make, saying what
                 will happen is more useful than asking a question with one answer. */
              <Notice tone="info" icon="coins" title={t('booking.payAtClinicOnlyTitle')}>
                {t('booking.payAtClinicOnlyBody', { clinic })}
              </Notice>
            )}

            <Button type="submit" variant="brand" size="lg" block>
              {t('booking.submit')}
            </Button>

            {/* Every shilling is the clinic's, and the patient is told so before they
                commit rather than in a footer they will not read. */}
            <p className="fine">{t('booking.priceNote', { service: service.name, clinic })}</p>
          </Stack>
        </form>
      )}
    </Frame>
  )
}

/**
 * The page furniture, in one place.
 *
 * Four of the branches above are terminal — no service chosen, the catalogue did not
 * load, the service was withdrawn, and the ordinary case — and every one of them needs
 * the same heading and the same way back. Repeating that is how three of the four end up
 * subtly different.
 */
function Frame({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow: string
  title: string
  action: ReactNode
  children: ReactNode
}) {
  return (
    <PageBody>
      <SitePageHeader eyebrow={eyebrow} title={title} actions={action} />

      <Stack gap="7">{children}</Stack>
    </PageBody>
  )
}
