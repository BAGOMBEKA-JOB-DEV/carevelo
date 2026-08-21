import { Badge, Card, Grid, Notice, PageHeader, Stack } from '@carevelo/ui'
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
 * colour, which is the one colour that must never appear on Carevelo's own tooling. So this
 * uses `Grid` in its default arm — the plain layout grid — rather than `Grid panel`, which
 * is the `.cellgrid` shape.
 *
 * THE PLAN CARDS ARE `<h2>` AND WERE `<h3>`, WHICH WAS A SKIPPED LEVEL. The page's own
 * heading is the `<h1>` PageHeader renders and there was nothing between it and these
 * cards. A screen-reader user navigating by heading hears a jump from level 1 to level 3 as
 * a section they have missed, and goes back looking for one that does not exist. Nothing
 * about it is visible on screen, which is why it survived.
 */
export function PlannedSection({ id }: { id: SectionId }) {
  const section = SECTIONS[id]

  return (
    <ControlPlaneShell title={section.label} active={id}>
      <PageHeader
        title={section.label}
        description={section.lede}
        /* A word, not a colour. A coloured dot alone is invisible to a screen reader. */
        actions={<Badge tone="warn">Not built yet</Badge>}
      />

      <Stack gap="5">
        <Notice>
          Nothing on this screen works yet. The route exists so that the link in the nav
          goes somewhere honest instead of a 404 — and so that a 404 here comes to mean
          something has genuinely broken, which it could not while every link was broken.
        </Notice>

        {section.caution ? <Notice tone="info">{section.caution}</Notice> : null}

        <Grid cols={2} gap="5">
          {section.plans.map((plan) => {
            const headingId = `plan-${slug(plan.title)}`

            return (
              <Card as="section" aria-labelledby={headingId} key={plan.title}>
                <Stack gap="3">
                  <h2 id={headingId}>{plan.title}</h2>
                  <p className="muted">{plan.body}</p>
                </Stack>
              </Card>
            )
          })}
        </Grid>
      </Stack>
    </ControlPlaneShell>
  )
}

/**
 * A heading's own words, as an id.
 *
 * Derived from the title rather than from the array index, because an id is what
 * `aria-labelledby` resolves against and two sections on one page must not collide — and a
 * plan reordered in `sections.ts` would silently move an index-based id onto a different
 * heading. The titles in that file are short English phrases, so this is enough; it is not
 * a general slugifier and does not need to be.
 */
function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
