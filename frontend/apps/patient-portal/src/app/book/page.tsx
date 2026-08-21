import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Button, EmptyState, Icon } from '@carevelo/ui'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant, type Tenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { BookingScreen } from '@/domains/scheduling'
import { readRegistrationHandoff } from '@/domains/patients'
import { SiteShell } from '@/components/SiteShell'
import { SCHEDULING_PATHS } from '../paths'

/**
 * Booking: a service, a clinician, a day, a slot and a mode, in one screen.
 *
 * ------------------------------------------------------------------------------------
 * THE PATIENT RECORD IDENTIFIER, WHICH IS A PLATFORM GAP AND NOT A CHOICE MADE HERE.
 *
 * `BookingScreen` needs a `patientId` and says plainly that it is the one thing the
 * scheduling domain cannot fetch for itself. Composing that across domains is exactly what
 * a route is for — except that today there is no endpoint to compose. Verified against the
 * backend rather than assumed:
 *
 *   - `MeResource` carries id, name, email, phone, `password_change_required` and roles.
 *     No patient id, and a user may own several patient records (`User::ownedPatientIds()`
 *     returns a list — a parent booking for a child is the ordinary case).
 *   - `GET /v1/patients` authorises `PatientPolicy::viewAny`, which admits ClinicAdmin,
 *     Clinician and FrontDesk only.
 *   - `GET /v1/patients/{patient}` authorises `PatientPolicy::view`, whose role list does
 *     not include the patient either — a patient cannot read their own record by id.
 *
 * So the only patient identifier this portal may hold is the one the patients domain put
 * in the registration handoff cookie, which lasts thirty minutes and exists to carry a
 * self-registration from /register to /consent. That covers somebody registering and
 * booking in one sitting and nobody else.
 *
 * WHAT THIS ROUTE DOES ABOUT IT: says so. It does not guess an identifier from the
 * patient's own appointments or prescriptions — both resources carry `patient_id` and both
 * are patient-readable, so it could — because that answer is wrong for a user who owns two
 * records and silently books a mother's consultation onto her child. `AppointmentPolicy`
 * checks that the CALLER may book and does NOT check that the `patient_id` in the body is
 * one they own; the endpoint is written for a front desk booking on behalf of whoever
 * telephones. A wrong guess here would therefore be accepted by the API and discovered by
 * the wrong person arriving at the clinic.
 *
 * THE FIX IS ONE FIELD ON `MeResource`. See the report accompanying this route layer.
 * Until then the honest screen is the one below: what is wrong, what to do instead, and a
 * way through to the catalogue so the visit is not wasted.
 * ------------------------------------------------------------------------------------
 *
 * Everything else here is pass-through. `?service=`, `?clinician=`, `?day=`, `?problem=`
 * and `?message=` are read off the URL and handed over unaltered; what each means, and
 * which values are safe, belongs to the domain that renders them.
 */
export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{
    service?: string
    clinician?: string
    day?: string
    problem?: string
    message?: string
  }>
}) {
  const [tenant, user, handoff, params] = await Promise.all([
    resolveTenant(),
    currentUser(),
    readRegistrationHandoff(),
    searchParams,
  ])

  // The same two redirects as app/account/page.tsx, and for the same reasons.
  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  if (handoff === null) {
    return <CannotIdentifyRecord tenant={tenant} />
  }

  return (
    <SiteShell tenant={tenant} signedIn>
      <BookingScreen
        tenant={tenant}
        patientId={handoff.patientId}
        paths={SCHEDULING_PATHS}
        serviceId={params.service}
        clinicianId={params.clinician}
        day={params.day}
        /*
         * NOT PASSED, AND THE DEFAULT IS THE SAFE DIRECTION. Whether the clinic can take
         * money through the portal at all is `AggregatorAccountResource.accepts_online_payment`
         * on an administrator-only endpoint, so this route genuinely cannot know it. False
         * means the patient is offered pay-at-the-desk; true and wrong means a slot held
         * for fifteen minutes against a payment nobody can make. `SCHEDULING_PATHS.payment`
         * is still supplied, which is a different question — see paths.ts.
         */
        problem={params.problem}
        message={params.message}
      />
    </SiteShell>
  )
}

/**
 * The screen for a signed-in patient whose record this portal cannot name.
 *
 * IN THE ROUTE RATHER THAN IN A DOMAIN, deliberately and narrowly. This is not a booking
 * rule and not a clinical statement — it is the routing layer reporting that it could not
 * satisfy a precondition of the screen it was about to render, which is the same class of
 * thing as the redirects above it. Putting it in the scheduling domain would teach that
 * domain about an identity gap it has no part in, and it would then have to be re-explained
 * on every other screen the same gap eventually touches.
 *
 * IT NAMES THE TELEPHONE, because that is the channel that actually works today. A screen
 * that said only "unavailable" would send a patient who needs to be seen away with nothing.
 */
async function CannotIdentifyRecord({ tenant }: { tenant: Tenant }) {
  const [t, common] = await Promise.all([
    getTranslations('Routes'),
    getTranslations('Common'),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')
  const phone = tenant.contact?.phone

  return (
    <SiteShell tenant={tenant} signedIn>
      <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
        <EmptyState
          icon="calendar"
          title={t('booking.noRecordTitle')}
          action={
            <Button variant="brand" href="/services">
              <Icon name="file" /> {t('hub.services.action')}
            </Button>
          }
        >
          {/* Two whole sentences rather than one with "on {phone}" glued on: a translator
              handed that fragment in isolation cannot know what it attaches to, and in a
              language whose word order differs it may not attach there at all. */}
          {phone
            ? t('booking.noRecordBodyWithPhone', { clinic, phone })
            : t('booking.noRecordBody', { clinic })}
        </EmptyState>
      </div>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
