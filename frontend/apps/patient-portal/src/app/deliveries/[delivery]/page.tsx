import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { DeliveryTracking, getDeliveryTracking } from '@/domains/delivery'
import { SiteShell } from '@/components/SiteShell'

/**
 * Where the package has got to.
 *
 * REACHED FROM A LINK THE CLINIC SENT, for the same reason as the fulfilment page:
 * `DeliveryController::index()` authorises `viewAny` — clinic staff — so a patient cannot
 * discover their own delivery identifiers from the API at all. There is no "my deliveries"
 * screen in this portal and inventing one would mean inventing the endpoint behind it.
 *
 * THE CLINIC'S TELEPHONE NUMBER IS PASSED AND IT IS LOAD-BEARING. There is no
 * patient-callable reschedule: a failed delivery is sent out again by a dispatcher
 * reassigning it on the clinic's own board, so the screen offers the number instead of a
 * button that would do nothing. Passing it from here rather than fetching it inside the
 * domain is the same rule as everywhere else — the tenant is `@/lib`, and a domain that
 * imported `@/lib/tenant` would be a domain that could not be rendered without a request.
 *
 * THE PAGE REFRESHES ITSELF WHILE THE DELIVERY IS STILL MOVING and offers a manual check
 * that is a plain form post, so it works with no JavaScript at all. Nothing needs plumbing
 * for either, and nothing here may add caching: a tracking page served from a cache tells a
 * patient their medicine is still at the pharmacy while the rider is at their gate.
 */
export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ delivery: string }>
}) {
  const [tenant, user, common, { delivery }] = await Promise.all([
    resolveTenant(),
    currentUser(),
    getTranslations('Common'),
    params,
  ])

  // The same two redirects as app/account/page.tsx.
  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  const result = await getDeliveryTracking(delivery)

  // 404 for a delivery that never existed and for another clinic's alike. No branch here
  // may recover the difference — that a named person is a patient of some other clinic is
  // exactly the fact the isolation boundary exists to keep.
  if (!result.ok && result.notFound) {
    notFound()
  }

  return (
    <SiteShell tenant={tenant} signedIn>
      <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
        <DeliveryTracking
          result={result}
          clinic={tenant.trading_name ?? common('thisClinic')}
          clinicPhone={tenant.contact?.phone ?? undefined}
        />
      </div>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
