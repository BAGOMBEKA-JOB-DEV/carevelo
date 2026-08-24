/**
 * The rider view's two sections — one entry per tab.
 *
 * WHY THIS FILE EXISTS. Both tabs once pointed at routes that did not exist, so the whole
 * of this surface's navigation was a 404. On the smallest surface in the product that is
 * the easiest kind of breakage to leave in place: two links, both broken, nothing to
 * compare them against. The tab bar is generated from this list, so a tab cannot exist
 * without a route being named for it here.
 *
 * IT USED TO CARRY MORE, AND WHAT IT CARRIED IS WORTH RECORDING. Each section also held a
 * lede, a caution and a list of "plans" — a description of the screen that would eventually
 * be built — which `PlannedSection` rendered on the tabs that had no screen yet. Both tabs
 * have screens now: `AssignmentsScreen` and `CompletedScreen` say what they are in their
 * own headings, which is where a page's description belongs. Keeping a second copy here
 * would be two sets of words for one screen, free to drift, with only one of them on
 * display. So the placeholder went, and this file is the tab bar's own data and nothing
 * else.
 *
 * TWO SECTIONS, AND IT SHOULD STAY TWO. The rider is the least-trusted actor in the system
 * and has the fewest things to do: see the next delivery, change its status, check what
 * they finished. Anything that wants to be a third tab here should be read as a request to
 * give a rider information they do not need — and the first such request is always the
 * clinic's dispatch board, which is a `viewAny` the rider policy refuses.
 *
 * NOTHING CLINICAL IS NAMED HERE, and nothing clinical may ever be. A rider never sees a
 * diagnosis, a clinical note, or a medicine name. The backend enforces that with a
 * rider-specific resource class rather than the dispatcher's with fields hidden, and this
 * app carries only the delivery and identity domains so that a clinical component cannot
 * exist in the bundle at all. This file is the navigation layer of the same rule.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 */

export type Section = {
  /** The route. Needs a matching directory under src/app, or the tab 404s. */
  readonly href: string
  /** Tab label. Short, because it sits in a bar two items wide on a 360px screen. */
  readonly label: string
}

/** Tab order, left to right. */
export const SECTION_IDS = ['assignments', 'completed'] as const

export type SectionId = (typeof SECTION_IDS)[number]

export const SECTIONS: Record<SectionId, Section> = {
  /** The round in front of the rider: assigned, picked up, en route. */
  assignments: {
    href: '/assignments',
    label: 'Assignments',
  },

  /**
   * Recently finished work — delivered, could not be delivered, returned to the pharmacy.
   *
   * "RECENTLY" IS THE SERVER'S WORD AND IT IS 72 HOURS. See
   * `RiderDeliveryController::COMPLETED_WINDOW_HOURS`, which argues the number: a rider's
   * handset is a personal phone that leaves the clinic every evening, and an all-time
   * history would turn it into a standing list of a clinic's patients and where they live.
   */
  completed: {
    href: '/completed',
    label: 'Completed',
  },
}
