import type { Metadata } from 'next'
import { Notice } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'
import { getOrder, mayBeDelivered } from '@/domains/dispensing'
import { currentStaff, NewDeliveryScreen } from '@/domains/delivery'
import { DISPATCH_PATHS } from '../paths'

/**
 * Dispatching a dispensed order.
 *
 * ------------------------------------------------------------
 * THE CONTROLLED-SUBSTANCE JUDGEMENT IS MADE ONCE, IN THE DISPENSING DOMAIN, AND CARRIED
 * HERE AS A BOOLEAN.
 *
 * `mayBeDelivered()` reads the prescription's `is_controlled` flags. This route calls it and
 * passes the answer; the delivery domain does not recompute it and must never be given the
 * items so that it could. Two implementations of "may this go on a motorcycle" is one
 * disagreement away from a controlled medicine leaving the premises, and the rule has no
 * override anywhere in the product.
 *
 * It also errs toward refusal when the prescription is not on the payload, which is why
 * this route reads the ORDER (`GET /v1/dispense-orders/{id}`, which loads the prescription)
 * rather than reusing the queue listing (which deliberately does not).
 *
 * ------------------------------------------------------------
 * THE ORDER ARRIVES AS `?order=`, AND IS NOT TRUSTED FOR ANYTHING BUT A LOOKUP.
 *
 * It is read straight off the URL and handed to the API. A cross-tenant identifier does not
 * resolve — row-level security has already narrowed the table — and the answer is the same
 * 404 as for one that never existed. So there is nothing to validate here that the API does
 * not validate better, and validating it here would only risk saying something the API
 * would not.
 */
export const metadata: Metadata = { title: 'New delivery' }

export default async function NewDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  const [viewer, params] = await Promise.all([currentStaff(), searchParams])
  const orderId = params.order

  return (
    <ConsoleShell title="Dispatch" active="dispatch">
      {viewer === null ? (
        <Notice tone="warn" title="You are not signed in">
          Creating a delivery is behind the clinic&rsquo;s own authentication, and this session
          has ended. Sign in again.
        </Notice>
      ) : viewer.password_change_required ? (
        <Notice tone="warn" title="Change your password first">
          Your account still has the password it was issued with. Until it is changed the API
          refuses everything else.
        </Notice>
      ) : orderId === undefined || orderId === '' ? (
        <Notice tone="warn" title="No order named">
          A delivery is always created for a dispensed order. Start from the dispatch board or
          from the order itself, rather than from this address on its own.
        </Notice>
      ) : (
        <Dispatchable orderId={orderId} viewer={viewer} />
      )}
    </ConsoleShell>
  )
}

/**
 * Reads the order, then hands the two facts the delivery domain needs to it.
 *
 * Split out so the guards above stay a flat list of conditions rather than nesting a fetch
 * inside them. The `try` is not decoration: a 404 for an order of another clinic reaches
 * here as a thrown `ApiError`, and it must render as "could not be found" rather than as the
 * framework's error boundary — which would say nothing and look like the console is broken.
 */
async function Dispatchable({
  orderId,
  viewer,
}: {
  orderId: string
  viewer: Awaited<ReturnType<typeof currentStaff>>
}) {
  try {
    const order = await getOrder(orderId)

    return (
      <NewDeliveryScreen
        orderId={order.id}
        orderReference={order.reference}
        deliverable={mayBeDelivered(order)}
        viewer={viewer}
        paths={DISPATCH_PATHS}
      />
    )
  } catch {
    /*
     * NO DETAIL, AND NO DISTINCTION BETWEEN "does not exist" AND "is not yours". The API
     * refuses to confirm that a record exists in another clinic, and a route that explained
     * the difference would undo that in one sentence.
     */
    return (
      <Notice tone="bad" title="That order could not be opened">
        It may not exist, or it may not be this clinic&rsquo;s. Start from the dispatch board.
      </Notice>
    )
  }
}
