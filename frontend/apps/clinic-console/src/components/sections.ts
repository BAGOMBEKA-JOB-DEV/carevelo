/**
 * The console's sections — one entry per item in the sidebar.
 *
 * WHY THIS FILE EXISTS. The six sidebar links were hand-written twice in ConsoleShell,
 * once for the desktop sidebar and once for the mobile tab bar, and every one of the
 * twelve resulting <a> tags pointed at a route that did not exist. A shell whose every
 * link 404s is worse than a shell with no links at all: it looks finished, and because
 * every link is broken, nobody notices when one genuinely breaks.
 *
 * So the nav is generated from this list and the placeholder screens read the same list.
 * `SECTIONS` is a Record over `SectionId`, so a section that appears in the nav without a
 * label, a purpose and a description of what will live there is a type error rather than
 * a blank page.
 *
 * WHAT THIS STILL DOES NOT GUARANTEE is that `href` resolves. `typedRoutes` is not enabled
 * on this app and next.config.ts belongs to a different change, so a seventh section added
 * without its directory under src/app would 404 exactly as these six did. Until the
 * compiler can check it, the check is `ls src/app` against the hrefs below — cheap, and
 * worth running whenever this list grows.
 *
 * THE PROSE IS NOT FILLER. Each screen says what will actually be there and which rule
 * shapes it, taken from the PRDs in docs/10-product. Somebody opening this console today
 * should come away with a truthful map of the product rather than a wall of 404s, and a
 * placeholder that says nothing achieves neither.
 */

/** One thing that will live on a section's screen. Rendered as a card. */
export type Plan = {
  readonly title: string
  readonly body: string
}

export type Section = {
  /** The route. Needs a matching directory under src/app, or the nav link 404s. */
  readonly href: string
  /** Sidebar label, topbar title and page heading — deliberately one word for all three. */
  readonly label: string
  /** One sentence: what this screen is for. */
  readonly lede: string
  /** A constraint a reader of this screen must not miss. Rendered as a standing notice. */
  readonly caution?: string | undefined
  readonly plans: readonly Plan[]
}

/** Sidebar order, and the order the map on the landing page lists them in. */
export const SECTION_IDS = [
  'schedule',
  'patients',
  'pharmacy',
  'dispatch',
  'payments',
  'settings',
] as const

export type SectionId = (typeof SECTION_IDS)[number]

export const SECTIONS: Record<SectionId, Section> = {
  schedule: {
    href: '/schedule',
    label: 'Schedule',
    lede: 'The clinician\'s day, and the front desk booking on a caller\'s behalf.',
    plans: [
      {
        title: 'The day view',
        body:
          'Every confirmed appointment for the clinician on duty, in Africa/Kampala, with '
          + 'the service booked and the consultation mode. A clinician cannot hold two '
          + 'overlapping confirmed appointments, so a full column is genuinely full.',
      },
      {
        title: 'Assisted booking',
        body:
          'Front desk books for a patient who telephoned the clinic. Most bookings in the '
          + 'first year will be made this way, which makes this the primary path through '
          + 'the screen rather than an administrative fallback bolted onto the side.',
      },
      {
        title: 'Held slots, shown as held',
        body:
          'A prepaid booking holds its slot for fifteen minutes and then releases it. '
          + 'Availability excludes a held slot, so a hold nothing ever releases removes a '
          + 'slot from the clinic\'s calendar permanently — the board has to show the '
          + 'difference between booked and merely held.',
      },
    ],
  },

  patients: {
    href: '/patients',
    label: 'Patients',
    lede: 'The registry, registration at the desk, and the consent record behind every entry.',
    caution:
      'A record in pending_consent may carry no clinical data at all. That is enforced in '
      + 'the database rather than by this screen, but the screen has to make the state '
      + 'obvious, because a member of staff who cannot see why a note will not save will '
      + 'find a way around the product.',
    plans: [
      {
        title: 'The registry',
        body:
          'Everyone this clinic may treat, and nobody else. There is no cross-clinic patient '
          + 'search and there will not be one; the isolation boundary between clinics is '
          + 'absolute.',
      },
      {
        title: 'Registration at the desk',
        body:
          'Identity, contact details and the guardian details a minor requires. A patient '
          + 'with no phone is registered against a next-of-kin number with consent from '
          + 'both, and the record is flagged so notifications are handled in person instead '
          + 'of vanishing into a handset nobody carries.',
      },
      {
        title: 'Consent capture',
        body:
          'What text, what version, when, and by whom — reconstructable months later, '
          + 'because "demonstrable" is the word the DPPA uses. Consent is an explicit '
          + 'affirmative action: no pre-ticked boxes and nothing bundled into a terms '
          + 'acceptance. Withdrawal writes a new record and never edits the old one.',
      },
      {
        title: 'Merge',
        body:
          'Two records for one person, merged within this clinic as an audited action. '
          + 'Never across clinics.',
      },
    ],
  },

  pharmacy: {
    href: '/pharmacy',
    label: 'Pharmacy',
    lede: 'The live dispensing queue for the clinic\'s own licensed pharmacy.',
    caution:
      'Medicines are held, priced, dispensed and handed over by the clinic\'s own '
      + 'NDA-licensed pharmacy, by its own licensed staff. Carevelo routes a work item and '
      + 'tracks a status: it holds no inventory, touches no medicine and takes no margin on '
      + 'one. This screen is a worklist, not a dispensary.',
    plans: [
      {
        title: 'The live queue',
        body:
          'Orders arriving from issued prescriptions, waiting to be checked and priced by a '
          + 'pharmacist. The prescription itself is a clinical document and is never edited; '
          + 'everything the pharmacy does happens on the dispense order, because what was '
          + 'prescribed and what was dispensed are different facts and both have to survive.',
      },
      {
        title: 'Pricing',
        body:
          'Line prices in UGX, entered by the pharmacy that will hand the medicine over. '
          + 'Every amount is a whole number of minor units and a currency, never a decimal.',
      },
      {
        title: 'Substitution proposals',
        body:
          'The pharmacist proposes a substitute with a reason and the prescriber approves or '
          + 'declines it. Auto-approval does not exist. A pending substitution blocks only '
          + 'its own item and the rest of the order proceeds — stall the whole order on one '
          + 'missing box and pharmacists will work around the system instead of in it.',
      },
    ],
  },

  dispatch: {
    href: '/dispatch',
    label: 'Dispatch',
    lede: 'The delivery board, and the rider each dispensed order is handed to.',
    plans: [
      {
        title: 'The board',
        body:
          'Dispensed orders waiting to go out, deliveries in flight, and the ones that came '
          + 'back. With no rider available an order simply holds at dispensed and the '
          + 'patient is told and offered pickup, rather than waiting on a collection that '
          + 'was never going to happen.',
      },
      {
        title: 'Rider assignment',
        body:
          'One rider, one delivery. What crosses to them is the recipient, the address and '
          + 'the package reference, so this screen shows the dispatcher exactly what the '
          + 'rider will be able to see before they assign it.',
      },
      {
        title: 'What cannot be delivered',
        body:
          'Controlled items are excluded from delivery entirely, and a delivery consent has '
          + 'to exist before any address reaches a rider. Both belong at the point of '
          + 'assignment, where a dispatcher can still act on them.',
      },
    ],
  },

  payments: {
    href: '/payments',
    label: 'Payments',
    lede: 'Cash attested at the desk, and the daily reconciliation against the aggregator\'s own record.',
    caution:
      'Carevelo reconciles records, not money. Money moves between the patient and the '
      + 'clinic through the clinic\'s own mobile-money account; the platform never holds a '
      + 'clinic\'s funds and can make no claim about them beyond repeating what the '
      + 'aggregator reported.',
    plans: [
      {
        title: 'Cash attestation',
        body:
          'A member of staff attests that cash was received and the payment resolves as paid '
          + 'at the clinic. The attestation writes an audit event naming that person — the '
          + 'clinic\'s own internal control, and honestly the only fraud control this design '
          + 'has to offer.',
      },
      {
        title: 'Daily reconciliation',
        body:
          'What the aggregator told us, each line carrying the reference an administrator '
          + 'needs to find the same transaction in their own aggregator dashboard. That is '
          + 'the most useful thing we can offer without claiming to see something we cannot.',
      },
      {
        title: 'Unresolved intents',
        body:
          'Every payment intent is checked on a schedule and none depends on a webhook '
          + 'arriving. A prompt the patient ignored times out but is not final, so a late '
          + 'success still turns up here and still has to be reconciled.',
      },
    ],
  },

  settings: {
    href: '/settings',
    label: 'Settings',
    lede: 'Everything about this clinic the product reads: how it looks, what it offers, when it opens, who works here.',
    plans: [
      {
        title: 'Branding',
        body:
          'A logo and two colours, applied as validated design tokens rather than as '
          + 'arbitrary CSS or markup. The readable foreground for the clinic\'s colour is '
          + 'computed server-side for WCAG AA, so a pale brand cannot produce unreadable '
          + 'text in the patient portal.',
      },
      {
        title: 'Services and prices',
        body:
          'Service names, durations, prices in UGX, the permitted consultation modes, and '
          + 'which staff roles may deliver each. The starter catalogue arrives pre-filled '
          + 'and editable; the prices arrive blank, because guessing a clinic\'s prices '
          + 'would be presumptuous and wrong.',
      },
      {
        title: 'Working hours',
        body:
          'Opening hours and holidays. Availability is derived from these together with the '
          + 'clinician\'s roster and the existing confirmed appointments — it is never a '
          + 'second list somebody maintains by hand.',
      },
      {
        title: 'Staff',
        body:
          'Invitations, roles and deactivation, each one an audited action.',
      },
      {
        title: 'Aggregator connection',
        body:
          'Mobile-money credentials, verified against the aggregator, with the aggregator\'s '
          + 'own error shown verbatim when they are rejected. A clinic with no aggregator '
          + 'account still completes onboarding and still runs consultations: every booking '
          + 'defaults to paying at the clinic. Payment is a feature; care is not blocked on '
          + 'it.',
      },
    ],
  },
}
