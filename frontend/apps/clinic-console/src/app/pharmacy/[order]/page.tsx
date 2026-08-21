import type { Metadata } from 'next'
import { Notice } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'
import { currentStaff, OrderScreen } from '@/domains/dispensing'
import { DISPENSING_PATHS } from '../paths'

/**
 * One dispense order at the bench.
 *
 * THE ROUTE CARRIES THE IDENTIFIER AND INTERPRETS NOTHING. Whether the order exists,
 * whether this member of staff may see it, and what a failure means are all the domain's
 * business, decided against the API's answer rather than guessed here.
 *
 * NO ORDER REFERENCE IN THE TAB TITLE. `generateMetadata` could fetch the order and put its
 * reference there, and that would mean a second audited read of a clinical record for the
 * sake of a browser tab — `DispenseOrderController::show` records `dispense_order.read` on
 * every call, because "who looked at my records?" can only be answered by having recorded
 * every look. A static title costs nothing and adds no line to somebody's access history.
 */
export const metadata: Metadata = { title: 'Order' }

export default async function OrderPage({
  params,
}: {
  params: Promise<{ order: string }>
}) {
  const [viewer, { order }] = await Promise.all([currentStaff(), params])

  return (
    <ConsoleShell title="Pharmacy" active="pharmacy">
      {viewer === null ? (
        <Notice tone="warn" title="You are not signed in">
          {/* See app/pharmacy/page.tsx: this console has no sign-in route yet, and a link
              to one that 404s is worse than a sentence that is true. */}
          This order is behind the clinic&rsquo;s own authentication, and this session has
          ended. Sign in again to open it.
        </Notice>
      ) : viewer.password_change_required ? (
        <Notice tone="warn" title="Change your password first">
          Your account still has the password it was issued with. Until it is changed the API
          refuses everything else, so this order cannot load.
        </Notice>
      ) : (
        <OrderScreen orderId={order} viewer={viewer} paths={DISPENSING_PATHS} />
      )}
    </ConsoleShell>
  )
}
