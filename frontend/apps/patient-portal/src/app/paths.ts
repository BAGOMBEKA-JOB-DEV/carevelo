import type { SchedulingPaths } from '@/domains/scheduling'

/**
 * Where the routing tree has mounted the screens the domains export.
 *
 * ONE PLACE, BECAUSE SEVERAL ROUTES HAVE TO AGREE. The scheduling domain hard-codes no URL
 * — every link and every post-submit redirect inside it is built from the `SchedulingPaths`
 * it is handed — which is what stops a Server Action being talked into redirecting
 * somewhere a form body named. The cost of that is that three routes (/services, /book,
 * /appointments) must be given the SAME object, and three copies of a literal are three
 * copies free to drift: a `browse` that pointed at a path nobody mounted would be a dead
 * "back to services" button, discovered by a patient.
 *
 * THIS FILE IS ROUTING, NOT LOGIC. It is a description of the routing tree, written down
 * where the routing tree lives, and it decides nothing — no branch, no fetch, no rule. It
 * is also the reason `.dependency-cruiser.cjs` forbids `src/domains` from importing
 * `src/app`: this knowledge points one way only, from the routes down into the domains.
 */
export const SCHEDULING_PATHS: SchedulingPaths = {
  /** The catalogue: what the clinic offers and what it costs. */
  browse: '/services',
  /** The booking journey — service, clinician, day, slot, mode. Takes `?service=` etc. */
  book: '/book',
  /** What has been booked. Takes `?past=&cursor=&booked=&cancelled=&problem=&message=`. */
  appointments: '/appointments',
  /**
   * Where the payments domain collects for an appointment. It receives `?appointment=<id>`,
   * which is the shape scheduling emits — see `AppointmentRow`'s "pay now" and the booking
   * action's redirect — so the route mounted here reads the appointment from the QUERY
   * rather than from a path segment.
   *
   * SUPPLIED EVEN THOUGH `onlinePaymentAvailable` IS NOT, and the two are not the same
   * question. Omitting this would remove "pay now" from an appointment that is ALREADY
   * holding a slot in `awaiting_payment` — booked prepaid at the front desk, say — and
   * that patient has fifteen minutes and nowhere to spend them. `onlinePaymentAvailable`
   * governs something else: whether a patient may CHOOSE prepaid while booking, which
   * depends on `AggregatorAccountResource.accepts_online_payment`, an administrator-only
   * field this portal cannot read. That one stays at its safe default of false.
   */
  payment: '/pay/appointment',
}

/** The status screen for one payment attempt. Matches `app/payments/[payment]/page.tsx`. */
export const PAYMENT_STATUS_TEMPLATE = '/payments/{id}'

/**
 * Where a patient pays for a dispensed order. Matches `app/pay/order/[order]/page.tsx`.
 *
 * `{id}` IS THE PLACEHOLDER, AND IT IS THE SAME CONVENTION AS `PAYMENT_STATUS_TEMPLATE`
 * ABOVE. The dispensing domain's `OrderList` needs to build this path for one row out of a
 * page of them, and it takes the template rather than a function for the reason every path
 * in that domain is a string: a domain that hard-codes a URL cannot be mounted anywhere
 * else, and one that took a function would need something serialisable across a boundary it
 * does not have. The route substitutes nothing — the domain does, once per row, encoding
 * the id as it goes.
 */
export const ORDER_PAYMENT_TEMPLATE = '/pay/order/{id}'

/**
 * The same path, already substituted, for a caller that holds exactly one order.
 *
 * Built FROM the template rather than beside it, so there is one literal to keep in step
 * with the routing tree instead of two that agree until somebody moves the page.
 */
export function orderPaymentPath(orderId: string): string {
  return ORDER_PAYMENT_TEMPLATE.replace('{id}', encodeURIComponent(orderId))
}
