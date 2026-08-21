/**
 * The rider view's two sections — one entry per tab.
 *
 * WHY THIS FILE EXISTS. Both tabs pointed at routes that did not exist, so the whole of
 * this surface's navigation was a 404. On the smallest surface in the product that is the
 * easiest kind of breakage to leave in place: two links, both broken, nothing to compare
 * them against. The tab bar is now generated from this list and the placeholder screens
 * read the same list, so a tab cannot exist without a screen describing what belongs
 * behind it.
 *
 * TWO SECTIONS, AND IT SHOULD STAY TWO. The rider is the least-trusted actor in the system
 * and has the fewest things to do: see the next delivery, change its status. Anything that
 * wants to be a third tab here should be read as a request to give a rider information
 * they do not need.
 *
 * NOTHING CLINICAL IS DESCRIBED HERE, and nothing clinical may ever be. A rider never sees
 * a diagnosis, a clinical note, or — where it can be avoided — a medicine name. The
 * backend enforces that with a rider-specific resource class rather than the dispatcher's
 * with fields hidden, and this app carries only the delivery and identity domains so that
 * a clinical component cannot exist in the bundle at all. This file is the copy layer of
 * the same rule.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 */

/** One thing that will live on a section's screen. Rendered as a card. */
export type Plan = {
  readonly title: string
  readonly body: string
}

export type Section = {
  /** The route. Needs a matching directory under src/app, or the tab 404s. */
  readonly href: string
  /** Tab label and page heading. */
  readonly label: string
  /** One sentence: what this screen is for. */
  readonly lede: string
  /** A constraint a reader of this screen must not miss. Rendered as a standing notice. */
  readonly caution?: string | undefined
  readonly plans: readonly Plan[]
}

/** Tab order, left to right. */
export const SECTION_IDS = ['assignments', 'completed'] as const

export type SectionId = (typeof SECTION_IDS)[number]

export const SECTIONS: Record<SectionId, Section> = {
  assignments: {
    href: '/assignments',
    label: 'Assignments',
    lede: 'The deliveries assigned to you, and nothing else.',
    caution:
      'A rider is shown a recipient, an address and a package reference. No diagnosis, no '
      + 'clinical note and no medicine name reaches this screen — not hidden by the '
      + 'interface, but absent from the response the server sends it, which is a different '
      + 'and much stronger guarantee.',
    plans: [
      {
        title: 'Yours only',
        body:
          'The deliveries assigned to you. Another rider\'s work is not here, and neither is '
          + 'the clinic\'s dispatch board.',
      },
      {
        title: 'What each one shows',
        body:
          'Recipient name and phone, the delivery address with any landmark, and the package '
          + 'reference. That is the whole of it, and it is everything needed to hand a '
          + 'package to the right person.',
      },
      {
        title: 'Status',
        body:
          'Collected, on the way, delivered. A delivery that cannot be completed is recorded '
          + 'with a reason from a fixed list and returns to the pharmacy the same day — '
          + 'medicine belongs on licensed premises and never sits with a rider overnight.',
      },
    ],
  },

  completed: {
    href: '/completed',
    label: 'Completed',
    lede: 'The deliveries you have already finished.',
    plans: [
      {
        title: 'Finished runs',
        body:
          'What you delivered and when, in Africa/Kampala time, so you can check your own '
          + 'day against the clinic\'s record of it.',
      },
      {
        title: 'The ones that came back',
        body:
          'A delivery that could not be completed, with the reason recorded at the time and '
          + 'the return to the pharmacy noted against it. It stays visible here rather than '
          + 'quietly disappearing from your list.',
      },
    ],
  },
}
