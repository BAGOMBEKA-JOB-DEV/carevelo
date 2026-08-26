/**
 * The five screens that live under /payments, and the tab bar across the top of each.
 *
 * WHY MONEY, MESSAGES AND THE AUDIT TRAIL SHARE A SECTION. They are the clinic's record of
 * what it did and what it told people: a payment record, the message that announced it, and
 * the immutable line that says who acted. An administrator answering "was this patient
 * charged, were they told, and who at this clinic did it?" moves between all three within a
 * minute, and the nav in `src/components/sections.ts` has one entry for the lot.
 *
 * `Confirmed payments` JOINED THEM WHEN `GET /v1/revenue` LANDED, and it belongs beside
 * reconciliation rather than anywhere else in the console: both are administrator-only,
 * both are read from the same payment records, and the pair answers the two halves of the
 * same question — what came in over a month, and which single collection to go and check.
 * The tab is deliberately NOT called "Revenue". Not one field on that screen is, and a tab
 * label is the part a person quotes back to you on the phone.
 *
 * The alternative would be three top-level nav entries, which is very likely where this
 * ends up — the audit log is not a payments screen by any reading. That list belongs to
 * `src/components/sections.ts`, which is app-global and not this change's to extend, so the
 * tabs live here and the handover says so. Nothing below assumes the parent path; every
 * href is absolute, so promoting a tab to its own section is a change to one line.
 *
 * WHY IT LIVES IN A DOMAIN AND NOT IN src/components. `shared-must-not-know-domains`
 * forbids the reverse direction only, and this is data plus a list of links rather than
 * app-global chrome. The routes compose it, which is what routes are for.
 *
 * PLAIN <a>, NO usePathname, NO CLIENT COMPONENT. The active tab is a fact the page states
 * rather than one the frame guesses — the same call `ConsoleShell` makes and for the same
 * reason. Every navigation here is a document load anyway, so there is no persistent layout
 * being thrown away and no JavaScript to spend.
 */

export const MONEY_TABS = [
  {
    id: 'desk',
    href: '/payments',
    label: 'Money desk',
  },
  {
    id: 'confirmed',
    href: '/payments/confirmed',
    label: 'Confirmed payments',
  },
  {
    id: 'reconciliation',
    href: '/payments/reconciliation',
    label: 'Reconciliation',
  },
  {
    id: 'messages',
    href: '/payments/messages',
    label: 'Messages',
  },
  {
    id: 'audit',
    href: '/payments/audit',
    label: 'Audit log',
  },
] as const

export type MoneyTabId = (typeof MONEY_TABS)[number]['id']

/**
 * `active` is REQUIRED and has no null case, because every route under /payments is one of
 * these five. A screen that could not name its own tab would be a screen that does not
 * belong in this section.
 *
 * `aria-current="page"` alongside the colour, for the same reason `ConsoleShell` does it:
 * colour alone fails a colour-blind reader and says nothing at all to a screen reader.
 */
export function SectionNav({ active }: { active: MoneyTabId }) {
  return (
    <nav className="tabs" aria-label="Payments, messages and audit">
      {MONEY_TABS.map((tab) => (
        <a
          key={tab.id}
          href={tab.href}
          className={`tab${tab.id === active ? ' is-active' : ''}`}
          aria-current={tab.id === active ? 'page' : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  )
}
