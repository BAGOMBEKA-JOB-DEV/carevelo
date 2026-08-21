import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { FieldShell } from '@/components/FieldShell'
import { DeliveryScreen, getAssignment } from '@/domains/delivery'
import { AccessNotice, SignOutButton, currentRider, isRider } from '@/domains/identity'
import { DELIVERY_PATHS, SIGN_IN_PATH } from '@/app/paths'

/**
 * One delivery.
 *
 * THE READ IS DONE HERE RATHER THAN IN THE SCREEN, and that is the one asymmetry with
 * /assignments. `notFound()` belongs to the route, and this page is the only place that
 * can call it: `getAssignment()` returns null for 404 AND 403 alike, so one not-found page
 * covers both and nothing is disclosed about which clinic holds which record. A 403 would
 * confirm that a delivery exists somewhere, which is how somebody learns that a named
 * person is a patient of some other clinic — cross-tenant reads are 404, never 403, and
 * this route must not "helpfully" explain the difference.
 *
 * THE TAB SAYS "Delivery" AND NOT THE PACKAGE REFERENCE. A `generateMetadata` that named
 * it would need a second read of the same record — Next does not dedupe these, since the
 * API client sends every request with `no-store` — and that is a whole extra round trip on
 * somebody's own metered bundle to put a string into a tab a rider is not looking at. It
 * would also write a package identifier into browser history and into every server access
 * log between here and the API, for no one's benefit.
 *
 * `active="assignments"` because this screen IS the assignments section, one level down.
 * The tab bar has two entries and neither of them is "a delivery"; saying nothing is
 * current would leave a rider without the one signal that says where they are.
 */
export const metadata: Metadata = { title: 'Delivery' }

export default async function DeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ delivery: string }>
  searchParams: Promise<{
    report?: string
    done?: string
    already?: string
    problem?: string
    message?: string
  }>
}) {
  const [rider, { delivery: id }, query] = await Promise.all([
    currentRider(),
    params,
    searchParams,
  ])

  if (!rider) {
    redirect(SIGN_IN_PATH)
  }

  /*
   * The guards come BEFORE the read, deliberately. A non-rider's request would be refused
   * by `DeliveryPolicy::updateStatus` anyway, but there is no reason to make the call: the
   * answer is already known from the session, and not making it is one fewer request
   * carrying a delivery identifier around.
   */
  if (rider.password_change_required || !isRider(rider)) {
    return (
      <FieldShell active="assignments">
        <AccessNotice
          reason={rider.password_change_required ? 'password_change_required' : 'not_a_rider'}
        />
        <SignOutButton name={rider.name} />
      </FieldShell>
    )
  }

  const delivery = await getAssignment(id)

  if (!delivery) {
    notFound()
  }

  return (
    <FieldShell active="assignments">
      <DeliveryScreen
        delivery={delivery}
        paths={DELIVERY_PATHS}
        reporting={query.report === '1'}
        done={query.done}
        already={query.already === '1'}
        problem={query.problem}
        message={query.message}
      />

      <SignOutButton name={rider.name} />
    </FieldShell>
  )
}
