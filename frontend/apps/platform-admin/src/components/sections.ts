/**
 * The control plane's sections — one entry per item in the sidebar.
 *
 * WHY THIS FILE EXISTS. All three links were hand-written twice in ControlPlaneShell, once
 * for the sidebar and once for the mobile tab bar, and all six resulting <a> tags pointed
 * at routes that did not exist. The nav is generated from this list instead, so a section
 * cannot appear in the nav without a label and a route.
 *
 * IT USED TO CARRY THE PROSE FOR THE UNBUILT SCREENS TOO — a lede, a caution and three
 * planned-screen paragraphs per section, read by `PlannedSection`. All three sections have
 * real screens now, that component is gone, and the prose went with it rather than being
 * left behind as a second description of screens that can describe themselves. It was
 * roughly nine kilobytes of text imported by every route in the app, through a shell whose
 * job is to produce three navigation links.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */

export type Section = {
  /** The route. Needs a matching directory under src/app, or the nav link 404s. */
  readonly href: string
  /** Sidebar label and topbar title. */
  readonly label: string
}

/** Sidebar order. */
export const SECTION_IDS = ['tenants', 'billing', 'break-glass', 'audit'] as const

export type SectionId = (typeof SECTION_IDS)[number]

export const SECTIONS: Record<SectionId, Section> = {
  tenants: {
    href: '/tenants',
    label: 'Tenants',
  },

  /* Carevelo's OWN subscription revenue, billed to clinics -- never a clinic's patient
     payments, which go to that clinic's own Pesapal account and never pass through here. */
  billing: {
    href: '/billing',
    label: 'Billing',
  },

  'break-glass': {
    href: '/break-glass',
    label: 'Break-glass',
  },

  audit: {
    href: '/audit',
    label: 'Audit',
  },
}
