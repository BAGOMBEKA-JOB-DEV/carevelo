import { notFound, redirect } from 'next/navigation'
import { ApiError } from '@carevelo/api-client'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { PaymentMethodChooser } from '@/domains/payments'
import { byId, getAppointment, listServices } from '@/domains/scheduling'
import { SiteShell } from '@/components/SiteShell'
import { PAYMENT_STATUS_TEMPLATE } from '../../paths'
import { PageBody } from '@/components/PageBody'

/**
 * Paying for an appointment: choose how, then watch it.
 *
 * THE APPOINTMENT ARRIVES IN THE QUERY, NOT IN A PATH SEGMENT, and that is the scheduling
 * domain's shape rather than a preference. `SchedulingPaths.payment` is documented as
 * receiving `?appointment=<id>`, and both places that build the link — the "pay now" button
 * on a held appointment, and the booking action's redirect for an `awaiting_payment`
 * result — construct it that way. A `[appointment]` folder here would simply never be hit.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS ROUTE READS TWICE, AND WHY THE PRICE CANNOT COME FROM ANYWHERE ELSE.
 *
 * `PaymentMethodChooser` requires `amount` to be "the API's own priced value, never a
 * literal, never from the URL" — the amount is what the idempotency key is derived from and
 * what the patient is asked to authorise on their handset, so a figure this page invented
 * would be a figure the clinic never charged.
 *
 * `AppointmentResource` does not carry one. It carries `service_id`, deliberately: a
 * service NAME is health information about whoever booked it, so the resource omits both
 * the name and the price and the client resolves them from the clinic's catalogue, in-app,
 * behind authentication. Hence appointment → `service_id` → catalogue → `price`. Two round
 * trips, run concurrently, and the catalogue is small (`ServiceController` returns it
 * whole, unpaginated, because a patient choosing needs to see all of it).
 *
 * A SERVICE THAT IS NOT IN THE CATALOGUE IS A 404 RATHER THAN A GUESS. `ServiceController`
 * filters to `is_active` for a patient, so an appointment booked against a service the
 * clinic has since withdrawn resolves to nothing here. There is no honest price to show and
 * this page must not show a dishonest one; the patient still reaches the clinic through
 * /appointments, where the appointment and the clinic's telephone number both are.
 * ---------------------------------------------------------------------------------------
 *
 * `?after=` AND `?error=` ARE CARRIED THROUGH UNTOUCHED, and both matter. `after` is the id
 * of the attempt being retried and is what makes the derived idempotency key NEW — without
 * it the API replays the stored response and returns the patient to the failure they were
 * escaping. `error` is how a refused submission comes back with something to read.
 *
 * `?payable=` ON THE STATUS PATH is this route telling the status screen what was being
 * paid for, because `PaymentIntentResource` does not. See app/payments/[payment]/page.tsx.
 */
export default async function PayForAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ appointment?: string; after?: string; error?: string }>
}) {
  const [tenant, user, params] = await Promise.all([
    resolveTenant(),
    currentUser(),
    searchParams,
  ])

  // The same two redirects as app/account/page.tsx.
  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  const appointmentId = params.appointment

  if (appointmentId === undefined || appointmentId === '') {
    notFound()
  }

  const [appointment, services] = await Promise.all([
    readAppointment(appointmentId),
    listServices(),
  ])

  const service = byId(services).get(appointment.service_id)

  if (service === undefined) {
    notFound()
  }

  const selfPath = `/pay/appointment?appointment=${encodeURIComponent(appointmentId)}`

  return (
    <SiteShell tenant={tenant} signedIn>
      <PageBody>
        <PaymentMethodChooser
          tenant={tenant}
          payable={{ type: 'appointment', id: appointmentId }}
          amount={service.price}
          statusPathTemplate={`${PAYMENT_STATUS_TEMPLATE}?payable=appointment.${encodeURIComponent(appointmentId)}`}
          selfPath={selfPath}
          after={params.after}
          error={params.error}
        />
      </PageBody>
    </SiteShell>
  )
}

/**
 * The appointment, or this portal's own not-found.
 *
 * `getAppointment` throws rather than returning null, because a caller outside the
 * scheduling domain is expected to decide what a failure means on its own surface. Here it
 * means the page does not exist: a 404 for an appointment that never existed, a 403 for one
 * belonging to somebody else, and both rendered identically. Recovering the difference on
 * an error page is how you learn that a named person is a patient of some other clinic —
 * which is the disclosure the API's own 404-not-403 rule exists to prevent.
 *
 * ANYTHING ELSE IS RETHROWN. A 500 or a dropped connection is our problem, and dressing it
 * as a missing appointment would hide an outage behind a page that says the booking is not
 * there.
 */
async function readAppointment(id: string) {
  try {
    return await getAppointment(id)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      notFound()
    }

    throw error
  }
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
