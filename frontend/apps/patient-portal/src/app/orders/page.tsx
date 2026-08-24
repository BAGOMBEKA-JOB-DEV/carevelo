import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { listDispenseOrders, OrderList } from '@/domains/dispensing'
import { SiteShell } from '@/components/SiteShell'
import { PageBody } from '@/components/PageBody'
import { ORDER_PAYMENT_TEMPLATE } from '../paths'

/**
 * What the pharmacy is filling for this patient.
 *
 * THIS ROUTE IS THE WHOLE POINT OF THE PATIENT BRANCH ON `DispenseOrderController::index()`.
 * Two journeys — paying for a dispensed order, and choosing collection or delivery — have
 * had pages in this portal for some time and no way in: `viewOwn` sat unused on the policy,
 * the listing authorised `viewAny`, and so nothing a patient was allowed to call ever handed
 * them an order identifier. Both opened from a link the clinic sent, or not at all, and a
 * patient who lost the message lost the order. This is the entry point.
 *
 * MONEY IS ON THIS SCREEN, SO THE SESSION CHECK IS NOT A FORMALITY. The two redirects are
 * the ones /account already makes — asked of the API rather than read off the cookie,
 * because a cookie cannot know it has been invalidated by a deactivation, and because the
 * API refuses every other authenticated request while `password_change_required` stands.
 *
 * THE READ IS HERE AND THE RENDERING IS NOT. `listDispenseOrders` returns a result object
 * rather than throwing, and `OrderList` renders every branch of it — the page, the empty
 * state, the failure. That split is what keeps this file free of logic while still letting
 * the route own the one thing a route must own: the fetch, on the render Next can actually
 * stream.
 *
 * `?cursor=` IS THE ONLY PAGINATION AND THERE IS NO PAGE NUMBER, because the backend pages
 * the patient branch by cursor. An offset paginator skips rows when the pharmacy prices or
 * dispenses mid-read, and a skipped row here is an order nobody pays for.
 *
 * THE PAYMENT PATH IS PASSED IN, NOT HARD-CODED IN THE DOMAIN, and it comes from
 * app/paths.ts so the two routes that name it cannot drift. A row for an order awaiting
 * payment links straight to the payment screen; everything else links to the order's own
 * fulfilment page. Which is which is `awaitsPayment()` in the dispensing domain — a route
 * that made that call itself would be the order state machine restated in the routing tree.
 *
 * THE CLINIC'S NAME, NOT THE TENANT OBJECT, is what the component takes — which is why the
 * fallback is resolved here. It keeps the domain free of `@/lib` and rendering it in a test
 * a matter of passing a string.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>
}) {
  const [tenant, user, common, { cursor }] = await Promise.all([
    resolveTenant(),
    currentUser(),
    getTranslations('Common'),
    searchParams,
  ])

  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  const result = await listDispenseOrders({ cursor })

  return (
    <SiteShell tenant={tenant} signedIn>
      <PageBody>
        <OrderList
          result={result}
          clinic={tenant.trading_name ?? common('thisClinic')}
          basePath="/orders"
          paymentPathTemplate={ORDER_PAYMENT_TEMPLATE}
        />
      </PageBody>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
