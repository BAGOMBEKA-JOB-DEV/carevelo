import { notFound, redirect } from 'next/navigation'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { PaymentMethodChooser } from '@/domains/payments'
import { getDispenseOrder } from '@/domains/delivery'
import { SiteShell } from '@/components/SiteShell'
import { PAYMENT_STATUS_TEMPLATE } from '../../../paths'
import { PageBody } from '@/components/PageBody'

/**
 * Paying for a dispensed order.
 *
 * THE PRICE IS THE ORDER'S OWN `total`, read on this render. `DispenseOrderResource` states
 * `subtotal`, `delivery_fee` and `total` as minor units, all three priced by the pharmacist
 * — so unlike an appointment there is nothing to resolve and nothing this page could get
 * wrong except by arithmetic of its own, which it does not do. `total` is what the clinic
 * is charging, including the delivery fee if the patient chose delivery, and it is the
 * figure the idempotency key is derived from.
 *
 * REACHED FROM A LINK THE CLINIC SENT. There is no patient-facing listing of dispense
 * orders — `DispenseOrderController::index()` authorises `viewAny`, which is clinic staff
 * only — so nothing in this portal can offer a patient a list of things to pay for. See
 * app/orders/[order]/fulfilment/page.tsx for the full note.
 *
 * A 404 COVERS "NO SUCH ORDER" AND "ANOTHER CLINIC'S ORDER" ALIKE, and a failure that is
 * NOT a 404 is not one either — but on this page an unreadable order means an unknown
 * amount, and an unknown amount is not something to render a payment form around. So a
 * non-404 failure falls to `notFound()` as well rather than to a chooser with no price,
 * and the patient reaches the clinic through the message that brought them here.
 *
 * `?after=` AND `?error=` ARE CARRIED THROUGH UNTOUCHED — see app/pay/appointment/page.tsx
 * for why `after` is the difference between a retry and a replay.
 */
export default async function PayForOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ order: string }>
  searchParams: Promise<{ after?: string; error?: string }>
}) {
  const [tenant, user, { order }, query] = await Promise.all([
    resolveTenant(),
    currentUser(),
    params,
    searchParams,
  ])

  // The same two redirects as app/account/page.tsx.
  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  const result = await getDispenseOrder(order)

  if (!result.ok) {
    notFound()
  }

  return (
    <SiteShell tenant={tenant} signedIn>
      <PageBody>
        <PaymentMethodChooser
          tenant={tenant}
          payable={{ type: 'dispense_order', id: result.order.id }}
          amount={result.order.total}
          statusPathTemplate={`${PAYMENT_STATUS_TEMPLATE}?payable=dispense_order.${encodeURIComponent(result.order.id)}`}
          selfPath={`/pay/order/${encodeURIComponent(order)}`}
          after={query.after}
          error={query.error}
        />
      </PageBody>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
