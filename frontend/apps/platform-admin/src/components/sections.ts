/**
 * The control plane's sections — one entry per item in the sidebar.
 *
 * WHY THIS FILE EXISTS. All three links were hand-written twice in ControlPlaneShell, once
 * for the sidebar and once for the mobile tab bar, and all six resulting <a> tags pointed
 * at routes that did not exist. The nav is now generated from this list and the placeholder
 * screens read the same list, so a section cannot appear in the nav without a label, a
 * purpose and a description of what will live there.
 *
 * THE TONE HERE IS DELIBERATELY DIFFERENT FROM THE CONSOLE'S. This is Carevelo's own
 * internal tool, operated on other people's clinics. Every screen described below is one
 * where the honest thing to state is the limit of what an operator may do, not the extent
 * of it — platform roles reach tenant administration and not tenant clinical data, and the
 * one path across that line is time-boxed, reasoned, audited and told to the clinic.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 * @see docs/50-security-compliance/audit-logging.md
 */

/** One thing that will live on a section's screen. Rendered as a card. */
export type Plan = {
  readonly title: string
  readonly body: string
}

export type Section = {
  /** The route. Needs a matching directory under src/app, or the nav link 404s. */
  readonly href: string
  /** Sidebar label, topbar title and page heading. */
  readonly label: string
  /** One sentence: what this screen is for. */
  readonly lede: string
  /** A constraint a reader of this screen must not miss. Rendered as a standing notice. */
  readonly caution?: string | undefined
  readonly plans: readonly Plan[]
}

/** Sidebar order. */
export const SECTION_IDS = ['tenants', 'break-glass', 'audit'] as const

export type SectionId = (typeof SECTION_IDS)[number]

export const SECTIONS: Record<SectionId, Section> = {
  tenants: {
    href: '/tenants',
    label: 'Tenants',
    lede: 'The register of clinics on Carevelo, and their lifecycle.',
    caution:
      'Administration only. A clinic\'s patients, consultations and prescriptions are not '
      + 'reachable from this screen and no amount of platform seniority changes that — the '
      + 'only path across the line is a break-glass grant, which is a different screen '
      + 'precisely so that taking it is a deliberate act.',
    plans: [
      {
        title: 'The register',
        body:
          'Every clinic, its trading name, its licence details and where it has got to in '
          + 'onboarding.',
      },
      {
        title: 'Provisioning',
        body:
          'A clinic starts in provisioning and becomes active when its checklist is '
          + 'complete: branding, at least one service, at least one clinician, consent '
          + 'templates. The checklist is the gate, so this screen shows what is outstanding '
          + 'rather than a switch somebody can flip.',
      },
      {
        title: 'Suspension',
        body:
          'For non-payment or policy. Suspension blocks staff sign-in; it does not stop a '
          + 'patient reading their own records and it does not abandon a delivery already in '
          + 'flight. A commercial dispute must not become a clinical incident, and this '
          + 'screen has to make the difference obvious to whoever is about to click it.',
      },
    ],
  },

  'break-glass': {
    href: '/break-glass',
    label: 'Break-glass',
    lede: 'Time-boxed emergency access to a clinic\'s data — requested with a reason, and never quiet.',
    caution:
      'Every request, grant and access is written to the platform audit log AND surfaced to '
      + 'the affected clinic. The clinic is the data controller and we are its processor: it '
      + 'has a right to know when we read its records, and that notification is not a '
      + 'setting anyone can turn off.',
    plans: [
      {
        title: 'Requesting',
        body:
          'A named operator, a named clinic, a stated reason and an expiry. A grant with no '
          + 'end is not a grant, so the expiry is not optional and not open-ended.',
      },
      {
        title: 'Active grants',
        body:
          'What is open right now and when each one lapses. Access ends when the window ends '
          + 'rather than when somebody remembers to close it — an operator who still needs it '
          + 'asks again, which is a second audit entry and the point.',
      },
      {
        title: 'The history',
        body:
          'Kept permanently, and worth reading as a metric rather than a log: a rising count '
          + 'means the ordinary support tooling is inadequate, which is more useful to know '
          + 'than any single entry.',
      },
    ],
  },

  audit: {
    href: '/audit',
    label: 'Audit',
    lede: 'Platform audit metadata: what happened, to which clinic, by whom, and when.',
    caution:
      'Platform roles read platform events in full and METADATA ONLY for a clinic\'s events '
      + '— actor, action, subject identifier, time and outcome, with no clinical content and '
      + 'no patient detail. Reading the audit log is itself audited, or the log has a blind '
      + 'spot exactly where an insider would look.',
    plans: [
      {
        title: 'Platform events',
        body:
          'Tenant provisioning, break-glass requests and grants, and everything else that '
          + 'belongs to Carevelo rather than to one clinic. These carry no tenant and sit '
          + 'outside tenant row-level security.',
      },
      {
        title: 'Metadata for tenant events',
        body:
          'Identifiers and outcomes, minimised. Enough to answer "did that happen, when, and '
          + 'who did it" during an incident, and not enough to read a patient\'s record '
          + 'sideways through the audit trail.',
      },
      {
        title: 'Correlation',
        body:
          'Each event carries the request id that joins it to the application logs. Audit '
          + 'says what happened; the logs say how it went technically. Neither is a '
          + 'substitute for the other and this screen is the first half.',
      },
    ],
  },
}
