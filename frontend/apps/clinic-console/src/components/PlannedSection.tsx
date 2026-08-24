import { Badge, PageHeader } from '@carevelo/ui'
import { ConsoleShell } from './ConsoleShell'
import { SECTIONS, type SectionId } from './sections'

/**
 * A section of the console that has a route and a place in the nav, and does not have a
 * screen yet.
 *
 * WHY THIS IS NOT A STUB. A stub that mimics a feature — an empty table, a disabled
 * button, a chart of nothing — teaches a clinic to expect something that is not there and
 * teaches us nothing when it breaks. This says plainly that the screen is not built, and
 * then spends the space describing what will live there and which rule shapes it, so the
 * console reads as a truthful map of the product rather than as a finished thing with the
 * data missing.
 *
 * WHY IT IS ONE COMPONENT AND NOT SIX PAGES. Six near-identical files drift: one keeps a
 * heading the nav no longer uses, another loses its aria-current. Here every route is
 * three lines that name a section, and the section is the single place its label,
 * purpose and content live — the same list the nav is generated from.
 *
 * THE CLASSES ARE THE CONSOLE'S, NOT THE MARKETING SURFACE'S. `.cell` and `.cellgrid`
 * would have suited the shape of this page, but they are built on the --sr-* radius scale,
 * and spacing.css is explicit that the two scales do not cross: "nothing in the console
 * reaches for the marketing scale... a component that wants both is a component that has
 * not decided who it is talking to." `.cell` also tints its icon tile with --brand-primary,
 * the CLINIC's colour, which has no business on staff chrome. `.card` and `.grid` say the
 * same thing in the console's own register.
 */
export function PlannedSection({ id }: { id: SectionId }) {
  const section = SECTIONS[id]

  return (
    <ConsoleShell title={section.label} active={id}>
      <PageHeader
        title={section.label}
        description={section.lede}
        // A word, not a colour. The badge convention in components.css exists because a
        // coloured dot is unreadable to a colour-blind pharmacist and invisible to a screen
        // reader. Line comments rather than a JSX one: a curly-brace comment is an
        // attribute position's child, and there are no children inside an opening tag.
        actions={<Badge tone="warn">Not built yet</Badge>}
      />

      {/* A bare `.grid` is a single column with the standard gap, which is the only
          spacing this page needs. No new CSS: packages/ui belongs to another change. */}
      <div className="grid">
        <div className="notice">
          <p>
            Nothing on this screen works yet. The route exists so that the link in the nav
            goes somewhere honest instead of a 404 — and so that a 404 here comes to mean
            something has genuinely broken, which it could not while every link was broken.
          </p>
        </div>

        {section.caution ? (
          <div className="notice notice-info">
            <p>{section.caution}</p>
          </div>
        ) : null}

        <div className="grid g-2">
          {section.plans.map((plan) => (
            <div className="card stack" key={plan.title}>
              <h3>{plan.title}</h3>
              <p className="muted">{plan.body}</p>
            </div>
          ))}
        </div>
      </div>
    </ConsoleShell>
  )
}
