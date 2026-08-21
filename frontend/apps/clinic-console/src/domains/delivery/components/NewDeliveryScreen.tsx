import { Notice } from '@carevelo/ui'
import { createDelivery } from '../api/actions'
import { abilitiesOf } from '../api/deliveries'
import type { DispatchPaths, Viewer } from '../model/types'
import { NewDeliveryForm } from './NewDeliveryForm'

/**
 * Turning a dispensed order into a delivery.
 *
 * ------------------------------------------------------------
 * THE ORDER'S FACTS ARRIVE AS PROPS, AND THIS DOMAIN NEVER FETCHES THEM.
 *
 * `orderReference` and `deliverable` come from the dispensing domain, through the route.
 * That is the boundary working rather than an inconvenience: the controlled-substance rule
 * is `mayBeDelivered()` in that domain, and having a second implementation of it here — one
 * that read `is_controlled` for itself — would be two rules that can disagree about whether
 * a medicine may go on a motorcycle.
 *
 * `deliverable` DEFAULTS TOWARD REFUSAL WHEN THE PRESCRIPTION IS NOT LOADED, for the same
 * reason: being wrong that way costs a patient a delivery, and being wrong the other way
 * puts a controlled medicine in a rider's bag.
 *
 * ------------------------------------------------------------
 * THE ACTION IS BOUND HERE, ON THE SERVER, WITH BOTH ROUTES TO REVALIDATE AND THE TEMPLATE
 * TO REDIRECT TO. Neither can be supplied by the form: a revalidation target a request can
 * name is a cache somebody else can poison, and a redirect target a request can name is a
 * redirect an attacker writes.
 */
export function NewDeliveryScreen({
  orderId,
  orderReference,
  deliverable,
  viewer,
  paths,
}: {
  orderId: string
  orderReference: string
  deliverable: boolean
  viewer: Viewer | null
  paths: DispatchPaths
}) {
  const abilities = abilitiesOf(viewer)

  /*
   * NOT AN AUTHORISATION DECISION — `DeliveryController::store` authorises against
   * `DeliveryPolicy::viewAny`, and the policy comment explains the shape: "DeliveryPolicy
   * exposes no `create` ability: the board IS the creation surface, and the RBAC matrix
   * grants creation to exactly the roles that may see it." So this mirrors the same test
   * the API applies, purely so somebody who cannot do it is told rather than shown a form
   * that ends in a 403.
   */
  if (viewer && !abilities.seesTheBoard) {
    return (
      <Notice tone="info" title="Dispatch is not yours to run">
        Creating a delivery is open to the clinic administrator, the dispatchers and the
        pharmacists. Your account holds none of those roles here.
      </Notice>
    )
  }

  return (
    <NewDeliveryForm
      orderId={orderId}
      orderReference={orderReference}
      deliverable={deliverable}
      action={createDelivery.bind(
        null,
        [paths.board, paths.order(orderId)],
        paths.deliveryTemplate,
      )}
    />
  )
}
