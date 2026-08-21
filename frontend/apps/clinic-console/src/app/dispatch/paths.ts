import type { DispatchPaths } from '@/domains/delivery'
import { DISPATCH, PHARMACY } from '../pharmacy/paths'

/**
 * Where the delivery domain is mounted in this app.
 *
 * The two route constants are imported from the pharmacy's own paths file rather than
 * retyped, because the two surfaces link to each other constantly — an order to the delivery
 * it was sent to, a delivery back to the order it came from — and two copies of `/pharmacy`
 * is one rename away from a board full of dead links. A route file importing another route
 * file is allowed; a DOMAIN importing either is not, which is the boundary that actually
 * matters here.
 *
 * `deliveryTemplate` IS A STRING WHERE `delivery` IS A FUNCTION, and both exist on purpose.
 * A bound Server Action argument must be serialisable — a function passed as one compiles
 * and then fails at runtime — so `createDelivery` is bound with the template and substitutes
 * the identifier the API just minted. See `DispatchPaths` in the delivery domain.
 */

export const DISPATCH_PATHS: DispatchPaths = {
  board: DISPATCH,
  delivery: (id) => `${DISPATCH}/${encodeURIComponent(id)}`,
  deliveryTemplate: `${DISPATCH}/{id}`,
  newDelivery: (orderId) => `${DISPATCH}/new?order=${encodeURIComponent(orderId)}`,
  order: (orderId) => `${PHARMACY}/${encodeURIComponent(orderId)}`,
}
