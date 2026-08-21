import { FieldShell } from './FieldShell'
import { SECTIONS, type SectionId } from './sections'

/**
 * A tab that has a route and does not have a screen yet.
 *
 * WHY THIS IS NOT A STUB. A fake list of deliveries on a rider's phone is worse than an
 * empty one: a rider who has learned to distrust the screen will phone the clinic instead,
 * and then the product has cost the dispatcher time rather than saved it. This says the
 * screen is not built and describes what will be on it.
 *
 * ONE COLUMN, NOT A CARD GRID. The frame is 560px at most and this is a phone surface, so
 * the bare `.grid` — one column, standard gap — is the layout. `.g-2` would only fold back
 * to one column below 700px of VIEWPORT, which says nothing about a 560px container.
 */
export function PlannedSection({ id }: { id: SectionId }) {
  const section = SECTIONS[id]

  return (
    <FieldShell active={id}>
      <div className="page-head">
        <div className="grow">
          <h1>{section.label}</h1>
          <p>{section.lede}</p>
        </div>
        {/* A word, not a colour. A coloured dot alone is unreadable to a colour-blind
            rider and invisible to a screen reader. */}
        <span className="badge badge-warn">Not built yet</span>
      </div>

      <div className="grid">
        <div className="notice">
          <p>
            Nothing on this screen works yet. The route exists so the tab goes somewhere
            honest instead of a 404 — and so a 404 here comes to mean something has
            genuinely broken, which it could not while both tabs were broken.
          </p>
        </div>

        {section.caution ? (
          <div className="notice notice-info">
            <p>{section.caution}</p>
          </div>
        ) : null}

        {section.plans.map((plan) => (
          <div className="card stack" key={plan.title}>
            <h3>{plan.title}</h3>
            <p className="muted">{plan.body}</p>
          </div>
        ))}
      </div>
    </FieldShell>
  )
}
