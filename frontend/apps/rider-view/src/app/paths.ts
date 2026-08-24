import type { DeliveryPaths } from '@/domains/delivery'

/**
 * Where the routing tree has mounted the screens the domains export.
 *
 * ONE PLACE, BECAUSE THREE ROUTES HAVE TO AGREE. The delivery domain hard-codes no URL —
 * every link and every post-submit redirect inside it is built from the `DeliveryPaths`
 * it is handed — which is what stops a Server Action from being talked into redirecting
 * somewhere a form body named. The cost of that is that all three routes must be given the
 * SAME object, and three copies of a literal are three copies free to drift: an
 * `assignments` that pointed at a path nobody mounted would be a dead "all my deliveries"
 * link, found by a rider in the road.
 *
 * THIS FILE IS ROUTING, NOT LOGIC. It is a description of the routing tree, written down
 * where the routing tree lives, and it decides nothing — no branch, no fetch, no rule. It
 * is also why `.dependency-cruiser.cjs` forbids `src/domains` from importing `src/app`:
 * this knowledge points one way only, from the routes down into the domains.
 */
export const DELIVERY_PATHS: DeliveryPaths = {
  /** The rider's round. Takes `?cursor=&done=&problem=&message=`. */
  assignments: '/assignments',
  /**
   * What the rider finished recently. Takes `?cursor=` and nothing else — there is no
   * `done=` here, because nothing is recorded from this screen. It only reads.
   */
  completed: '/completed',
  /**
   * One delivery. Matches `app/assignments/[delivery]/page.tsx`, and `{delivery}` is
   * substituted by `deliveryHref()` rather than concatenated — see the domain's
   * model/links.ts. Takes `?report=&done=&already=&problem=&message=`.
   */
  delivery: '/assignments/{delivery}',
}

/** Where a guest is sent. Matches `app/sign-in/page.tsx`. */
export const SIGN_IN_PATH = '/sign-in'
