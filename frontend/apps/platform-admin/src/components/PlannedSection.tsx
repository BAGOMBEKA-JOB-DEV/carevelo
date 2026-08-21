import { ControlPlaneShell } from './ControlPlaneShell'
import { SECTIONS, type SectionId } from './sections'

/**
 * A section of the control plane that has a route and a place in the nav, and does not
 * have a screen yet.
 *
 * WHY THIS IS NOT A STUB. On this surface a convincing placeholder is actively dangerous:
 * an empty tenant table or a break-glass form that does nothing looks exactly like a
 * working control that found no results, and an operator during an incident is the last
 * person who should have to work out which. It says the screen is not built, and then uses
 * the space to state what will be there and what the limits on it are.
 *
 * WHY IT IS ONE COMPONENT AND NOT THREE PAGES. Three near-identical files drift — one
 * keeps a heading the nav no longer uses, another loses its aria-current. Here each route
 * is three lines naming a section, and the section is the single place its label, purpose
 * and content live.
 *
 * THE CLASSES ARE THE CONSOLE'S, NOT THE MARKETING SURFACE'S. `.cell` and `.cellgrid` suit
 * the shape of this page but are built on the --sr-* radius scale, and spacing.css is
 * explicit that the two scales do not cross: "nothing in the console reaches for the
 * marketing scale... a component that wants both is a component that has not decided who
 * it is talking to." `.cell` also tints its icon tile with --brand-primary, a clinic's
 * colour, which is the one colour that must never appear on Carevelo's own tooling.
 */
export function PlannedSection({ id }: { id: SectionId }) {
  const section = SECTIONS[id]

  return (
    <ControlPlaneShell title={section.label} active={id}>
      <div className="page-head">
        <div className="grow">
          <h1>{section.label}</h1>
          <p>{section.lede}</p>
        </div>
        {/* A word, not a colour. A coloured dot alone is invisible to a screen reader. */}
        <span className="badge badge-warn">Not built yet</span>
      </div>

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
    </ControlPlaneShell>
  )
}
