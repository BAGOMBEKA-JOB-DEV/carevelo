import type { Metadata } from 'next'
import { PlannedSection } from '@/components/PlannedSection'

/**
 * Not built — and, unlike the other screens in this app, not for want of building it.
 *
 * ==================================================================
 * THERE IS NO ENDPOINT THAT COULD SERVE THIS SCREEN.
 * ==================================================================
 *
 * The rider surface has exactly three endpoints, and the only listing among them,
 * `GET /v1/rider/deliveries`, filters to `assigned`, `picked_up` and `en_route` in the
 * controller and publishes NO query parameters at all — `operations['v1.rider.deliveries.index']`
 * types `query` as `never`. A delivered or failed delivery is therefore absent from every
 * response this app is able to ask for, and stays absent: `show` still answers for an id
 * the rider already holds, but nothing hands out the ids of finished work.
 *
 * So a "Completed" list built today would be a list that is always empty, on a screen that
 * promises otherwise. That is worse than an honest placeholder by some distance: a rider
 * who has learned to distrust one screen distrusts the assignments screen too, and then
 * telephones the clinic instead — which is the cost this product exists to remove.
 *
 * WHAT WOULD MAKE IT REAL. Either a status filter on the rider index, or a second
 * endpoint. Both are backend changes and both are disclosure decisions rather than
 * conveniences: they widen what a rider may read back, and how far, and the arguments for
 * a window ("today's round") and against a permanent history belong in the API, not here.
 *
 * WHAT MUST NOT HAPPEN IN THE MEANTIME. `GET /v1/deliveries` — the dispatcher's index —
 * would answer some of this and serves `DeliveryResource`, which carries `failure_reason`,
 * the dispense order and the rest of the clinic's record. It is `viewAny`, which the rider
 * policy refuses, and reaching for it would be the exact erosion the rider rule is written
 * against.
 *
 * The confirmation a rider actually gets instead is on the assignments screen, at the
 * moment they finish: see `AssignmentsScreen`'s `?done=` notices.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md — "The rider rule"
 */
export const metadata: Metadata = { title: 'Completed' }

export default function CompletedPage() {
  return <PlannedSection id="completed" />
}
