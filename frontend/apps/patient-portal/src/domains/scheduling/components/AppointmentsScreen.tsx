import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Button, EmptyState, Icon, Notice, Stack } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { cancelAppointment, listAppointments } from '../api/appointments'
import { byId, listClinicians, listServices } from '../api/catalogue'
import { attempt } from '../api/http'
import { addDays, clinicToday } from '../model/calendar'
import { href } from '../model/links'
import { knownStatus } from '../model/status'
import type {
  AppointmentStatus,
  AppointmentsPage,
  Clinician,
  SchedulingPaths,
  Service,
} from '../model/types'
import { AppointmentRow } from './AppointmentRow'
import { modeText, statusText } from './strings'
import { PageBody } from '@/components/PageBody'
import { SitePageHeader } from '@/components/SitePageHeader'

/**
 * WHAT THE PATIENT HAS BOOKED: two lists, split at the clinic's midnight.
 *
 * ------------------------------------------------------------
 * WHY THE SPLIT IS A DATE AND NOT A SORT
 *
 * "Coming up" is the screen a patient opens; "past" is the one they go looking for. A
 * single list sorted one way buries one of them — descending puts the furthest-future
 * appointment first, ascending puts a booking from last year first — so each is its own
 * query, each one round trip, each sorted the way that list reads: soonest first for what
 * is ahead, most recent first for what is behind.
 *
 * The boundary is the CLINIC's calendar date, not the server's. An appointment earlier
 * today stays under "coming up" until midnight, which is the right answer for a patient
 * wondering whether they have already missed it.
 *
 * ONE HONEST CAVEAT. `IndexAppointmentRequest::from()` parses the date with no timezone,
 * so `from=2026-08-21` is midnight UTC — three in the morning in Kampala. Anything
 * scheduled between midnight and 03:00 clinic time would therefore fall outside "coming
 * up". Nothing can be: slots are generated from `WorkingHour`, and no clinic configures
 * hours across the small hours. Written down rather than left as a surprise, because the
 * day the API's parsing changes this note is where to look.
 *
 * ------------------------------------------------------------
 * CURSOR PAGINATION, NOT OFFSET
 *
 * The clinic books into the same table while a patient pages through it, which is exactly
 * the traffic under which an offset duplicates and skips rows. `meta.next_cursor` is
 * followed; no page number is ever constructed.
 *
 * ------------------------------------------------------------
 * NOTHING HERE FILTERS BY PATIENT, AND THAT IS CORRECT
 *
 * `AuthorisesPatientReads` lets a patient through the listing only on the branch that
 * also narrows the query to the records they own. A `patient_id` filter added here would
 * do nothing and would suggest, wrongly, that it is what protects the data.
 */

export type AppointmentsScreenProps = {
  tenant: Tenant
  paths: SchedulingPaths
  /** `?past=1` — the appointments already behind them. */
  past?: boolean | undefined
  /** `?cursor=` — from `meta.next_cursor`. Never a page number. */
  cursor?: string | undefined
  /** `?booked=` — the reference of a booking just made, to confirm it landed. */
  booked?: string | undefined
  /** `?cancelled=1` — a cancellation just succeeded. */
  cancelled?: boolean | undefined
  /** `?problem=cancel_failed`. */
  problem?: string | undefined
  /** `?message=` — the API's own sentence about that failure. */
  message?: string | undefined
}

/**
 * The states the appointment state machine can legally leave by cancelling.
 *
 * Derived from `AppointmentStatus::allowedTransitions()` rather than guessed: offering
 * "cancel" on a completed appointment produces a 409 the patient can do nothing about,
 * and hiding it on a confirmed one sends them to the telephone for something they could
 * have done themselves — which leaves a slot nobody else can book.
 */
const CANCELLABLE: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
  'awaiting_payment',
  'payment_failed',
  'confirmed',
])

export async function AppointmentsScreen({
  tenant,
  paths,
  past = false,
  cursor,
  booked,
  cancelled = false,
  problem,
  message,
}: AppointmentsScreenProps) {
  const [t, common, modes, statuses] = await Promise.all([
    getTranslations('Scheduling'),
    getTranslations('Common'),
    modeText(),
    statusText(),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')
  const today = clinicToday(tenant.timezone)

  const loaded = await attempt(
    Promise.all([
      listAppointments(
        past
          ? { to: addDays(today, -1), newestFirst: true, cursor }
          : { from: today, cursor },
      ),
      listServices(),
      listClinicians(),
    ]),
  )

  async function cancelBooking(formData: FormData) {
    'use server'

    // A reference, not an assertion: which appointment. Whether it is THIS patient's is
    // decided by `AppointmentPolicy::cancel`, which is the only place that can decide it.
    const id = String(formData.get('appointment_id') ?? '')
    // Trimmed here so three spaces do not pass a `min:3` the API would reject anyway; the
    // API remains the authority and this only saves a round trip.
    const reason = String(formData.get('reason') ?? '').trim()

    // The destination NEVER comes from the form. A redirect target taken from a request
    // is an open redirect, and this one is built from paths the route layer supplied.
    const listing = { past: past ? '1' : undefined }

    if (id === '' || reason.length < 3) {
      return redirect(href(paths.appointments, { ...listing, problem: 'cancel_failed' }))
    }

    const outcome = await cancelAppointment(id, reason)

    if (outcome.kind === 'problem') {
      return redirect(
        href(paths.appointments, {
          ...listing,
          problem: 'cancel_failed',
          message: outcome.message ?? undefined,
        }),
      )
    }

    // The cursor is dropped on purpose: a row has just left this list, so a cursor taken
    // from the page before the change points into a list that no longer exists.
    return redirect(href(paths.appointments, { ...listing, cancelled: '1' }))
  }

  return (
    <PageBody>
      <SitePageHeader
        eyebrow={t('appointments.eyebrow')}
        title={past ? t('appointments.titlePast') : t('appointments.titleUpcoming')}
        description={
          past ? t('appointments.ledePast', { clinic }) : t('appointments.ledeUpcoming', { clinic })
        }
        actions={
          <Button variant="brand" href={paths.browse}>
            <Icon name="calendar" /> {t('appointments.bookOne')}
          </Button>
        }
      />

      {/* The 24px that used to be a `marginBottom` on the tab row is this Stack's gap. It
          was never a property of the row — it was the distance between the row and the
          list, which belongs to the column that holds both. */}
      <Stack gap="7">
        {/*
         * Two buttons rather than `.tab`, and the reason is the brand rule: the token
         * layer's active tab paints with `--primary`, which is CAREVELO's colour. On a
         * patient surface the accent is the CLINIC's, and `variant="brand"` takes its
         * foreground from `--brand-primary-fg` — the value the API computed for WCAG AA.
         */}
        <div className="site-btn-row">
          <Button
            variant={past ? 'quiet' : 'brand'}
            href={paths.appointments}
            aria-current={past ? undefined : 'page'}
          >
            {t('appointments.tabUpcoming')}
          </Button>
          <Button
            variant={past ? 'brand' : 'quiet'}
            href={href(paths.appointments, { past: '1' })}
            aria-current={past ? 'page' : undefined}
          >
            {t('appointments.tabPast')}
          </Button>
        </div>

        <Stack gap="6">
          {booked ? (
            <Notice tone="info" icon="check" title={t('appointments.bookedTitle')}>
              {t('appointments.bookedBody', { reference: booked })}
            </Notice>
          ) : null}

          {cancelled ? (
            <Notice tone="info" icon="check" title={t('appointments.cancelledTitle')}>
              {t('appointments.cancelledBody')}
            </Notice>
          ) : null}

          {problem === 'cancel_failed' ? (
            <Notice tone="bad" title={t('appointments.cancelFailedTitle')}>
              {message ?? t('appointments.cancelFailedBody')}
            </Notice>
          ) : null}

          {!loaded.ok ? (
            /* NOT an empty state. "You have no appointments" would be a statement of fact
               about the patient's care, and what actually happened is that the request did
               not answer. */
            <Notice tone="bad" title={t('appointments.unavailableTitle')}>
              {loaded.message ?? t('appointments.unavailableGeneric', { clinic })}{' '}
              {t('appointments.unavailableBody')}
            </Notice>
          ) : loaded.value[0].data.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={past ? t('appointments.emptyPastTitle') : t('appointments.emptyUpcomingTitle')}
              action={
                past ? undefined : (
                  <Button variant="brand" href={paths.browse}>
                    {t('appointments.bookOne')}
                  </Button>
                )
              }
            >
              {past
                ? t('appointments.emptyPastBody')
                : t('appointments.emptyUpcomingBody', { clinic })}
            </EmptyState>
          ) : (
            <List
              page={loaded.value[0]}
              services={byId(loaded.value[1])}
              clinicians={byId(loaded.value[2])}
              clinic={clinic}
              modes={modes}
              statuses={statuses}
              paths={paths}
              cancelBooking={cancelBooking}
              past={past}
              showMore={t('appointments.showMore')}
              showStart={t('appointments.showStart')}
            />
          )}
        </Stack>
      </Stack>
    </PageBody>
  )
}

/**
 * The rows and the pager.
 *
 * Split out so the branch above reads as the four things that can be on this screen —
 * a failed request, an empty list, the list, and the notices — rather than as one return
 * statement nobody can hold in their head.
 */
function List({
  page,
  services,
  clinicians,
  clinic,
  modes,
  statuses,
  paths,
  cancelBooking,
  past,
  showMore,
  showStart,
}: {
  page: AppointmentsPage
  services: Map<string, Service>
  clinicians: Map<string, Clinician>
  clinic: string
  modes: Awaited<ReturnType<typeof modeText>>
  statuses: Awaited<ReturnType<typeof statusText>>
  paths: SchedulingPaths
  cancelBooking: (formData: FormData) => Promise<void>
  past: boolean
  showMore: string
  showStart: string
}) {
  const listing = { past: past ? '1' : undefined }

  return (
    <>
      {/* `<Stack as="ul">`: the hand-rolled `<ul className="stack">` never reset the
          list, so this ran with the user agent's disc bullets and a 40px indent beside
          every appointment card. Stack strips both and restores `role="list"`, which
          Safari drops along with the marker. */}
      <Stack as="ul" gap="5">
        {page.data.map((appointment) => {
          const status = knownStatus(appointment.status)

          return (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              serviceName={services.get(appointment.service_id)?.name ?? null}
              clinicianName={clinicians.get(appointment.clinician_id)?.name ?? null}
              clinic={clinic}
              modes={modes}
              statuses={statuses}
              paths={paths}
              cancelAction={
                status !== null && CANCELLABLE.has(status) ? cancelBooking : undefined
              }
            />
          )
        })}
      </Stack>

      {page.meta.next_cursor !== null || page.meta.prev_cursor !== null ? (
        <div className="site-btn-row">
          {page.meta.prev_cursor !== null ? (
            <Button variant="quiet" href={href(paths.appointments, listing)}>
              {showStart}
            </Button>
          ) : null}

          {page.meta.next_cursor !== null ? (
            <Button
              variant="quiet"
              href={href(paths.appointments, { ...listing, cursor: page.meta.next_cursor })}
            >
              {showMore}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
