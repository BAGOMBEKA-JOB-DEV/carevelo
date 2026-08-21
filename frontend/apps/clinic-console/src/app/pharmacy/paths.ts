import type { DispensingPaths } from '@/domains/dispensing'

/**
 * Where the dispensing domain is mounted in this app.
 *
 * ------------------------------------------------------------
 * WHY THE DOMAIN DOES NOT KNOW ITS OWN URLS.
 *
 * Two reasons, and the second is the one that matters. The first is reuse: a domain that
 * hard-codes `/pharmacy` can only ever be mounted at `/pharmacy`. The second is that this
 * domain's server actions take a revalidation target, and a path a domain reads out of a
 * form field is a cache somebody else can point wherever they like. Binding these values
 * here, during a server render, makes the destination a fact of the build rather than a
 * request parameter.
 *
 * `newDelivery` POINTS INTO THE DELIVERY DOMAIN'S ROUTES, which is why it is a path and not
 * an import. The pharmacy links to dispatch and dispatch links back; that crossing is what
 * the route layer is for, and `.dependency-cruiser.cjs` forbids the domains doing it to each
 * other directly.
 *
 * ------------------------------------------------------------
 * WHAT THIS FILE DOES NOT GUARANTEE. `typedRoutes` is not enabled on this app, so a path
 * written here with no matching directory under `src/app` compiles and then 404s — the same
 * gap `src/components/sections.ts` records, and the same check until the compiler can do it:
 * read these against `ls src/app`.
 *
 * ENCODED, NOT INTERPOLATED RAW. Identifiers are ULIDs and cannot contain a character that
 * needs escaping, so `encodeURIComponent` changes nothing today. It is what stops that being
 * a load-bearing assumption the first time an identifier format changes.
 */

export const PHARMACY = '/pharmacy'
export const DISPATCH = '/dispatch'

export const DISPENSING_PATHS: DispensingPaths = {
  queue: PHARMACY,
  order: (id) => `${PHARMACY}/${encodeURIComponent(id)}`,
  newDelivery: (orderId) => `${DISPATCH}/new?order=${encodeURIComponent(orderId)}`,
}
