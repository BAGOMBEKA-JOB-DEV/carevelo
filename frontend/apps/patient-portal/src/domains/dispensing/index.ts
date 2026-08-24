/**
 * The dispensing domain's PUBLIC SURFACE.
 *
 * Everything this domain offers the rest of the app is exported here, and nothing else is
 * importable: reaching into ./components or ./api from another domain is a build failure,
 * not a code-review note. Cross-domain composition belongs in the route layer.
 *
 * WHAT THIS DOMAIN DOES: shows a patient the orders the pharmacy is filling for them. It
 * READS AND IT NEVER WRITES, and the one write a patient may make about an order — whether
 * they are collecting it or having it brought — deliberately lives in the DELIVERY domain
 * instead. That is not filing by accident: everything interesting about the fulfilment
 * decision is a delivery concern (the controlled-item exclusion, the service area, and the
 * `delivery_disclosure` consent that decides whether a home address may reach a rider), and
 * splitting it from the tracking screen that depends on it would put the consent gate one
 * domain away from the thing it gates. See `domains/delivery/api/fulfilment.ts`.
 *
 * This file was an empty `export {}` until the listing behind it existed. It exists now.
 *
 * ------------------------------------------------------------------------------------
 * WHY THERE IS SUDDENLY SOMETHING HERE
 *
 * `DispenseOrderPolicy::viewOwn()` has admitted a patient since it was written and nothing
 * called it. `DispenseOrderController::index()` authorised `viewAny` — clinic staff — so a
 * patient could open an order only if they ALREADY held its identifier, and no endpoint
 * they were allowed to call ever handed them one. Paying for a dispensed order and choosing
 * collection or delivery therefore had pages and no way in: both opened from a link the
 * clinic sent, or not at all. The controller now branches on `AuthorisesPatientReads`,
 * which authorises and narrows in a single call, and this domain is the portal's half.
 * ------------------------------------------------------------------------------------
 * HOW A ROUTE COMPOSES THIS
 *
 * The list, at `/orders`:
 *
 *   const [tenant, t] = await Promise.all([resolveTenant(), getTranslations('Common')])
 *   const { cursor } = await searchParams          // Next 16: searchParams is a promise
 *   const result = await listDispenseOrders({ cursor })
 *
 *   <OrderList
 *     result={result}
 *     clinic={tenant.trading_name ?? t('thisClinic')}
 *     paymentPathTemplate="/pay/order/{id}"
 *   />
 *
 * `OrderList` pages by CURSOR — it emits `?cursor=…` and nothing else. There is no page
 * number to plumb through, deliberately: the pharmacy is pricing and dispensing into the
 * same table while the patient reads it, which is precisely the traffic under which an
 * offset paginator duplicates and skips rows, and a skipped row here is an order nobody
 * pays for.
 *
 * `paymentPathTemplate` IS REQUIRED AND `{id}` IS THE PLACEHOLDER — the same convention as
 * `PAYMENT_STATUS_TEMPLATE` in app/paths.ts. A row for an order awaiting payment links
 * there; every other row links to `${basePath}/{id}/fulfilment`. The domain hard-codes
 * neither, so it can be mounted anywhere the routing tree likes.
 *
 * TWO THINGS THE ROUTE MUST DO AND THIS DOMAIN CANNOT:
 *
 *   1. REQUIRE A SESSION. Follow /account: `currentUser()`, redirect a guest to /sign-in,
 *      and redirect anyone whose `password_change_required` is set — while that flag
 *      stands, the API refuses every other request anyway.
 *   2. RESOLVE THE TENANT and pass `clinic`. The component takes the clinic's NAME rather
 *      than the tenant object, so it stays free of `@/lib` and rendering it in a test is a
 *      matter of passing a string.
 *
 * WHAT THIS DOMAIN MUST NEVER GROW. A medicine name. The listing does not load the
 * prescription relation and the controller withholds `substitutions` from a patient because
 * `SubstitutionResource` publishes `proposed_medicine_name`; the day something here reaches
 * for the contents of an order, it is reaching past a decision the API made on purpose. The
 * order's own screen, opened deliberately, is where the prescription belongs.
 */
export { OrderList } from './components/OrderList'

export { listDispenseOrders } from './api/orders'
export type {
  DispenseOrder,
  DispenseOrderStatus,
  OrderListResult,
  OrderPage,
  OrdersResult,
} from './api/orders'
