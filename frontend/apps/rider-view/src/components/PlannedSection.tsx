import { Badge, Card, Notice, PageHeader, Stack } from '@carevelo/ui'
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
 * ONE COLUMN, NOT A CARD GRID. The frame is 560px at most and this is a phone surface, so a
 * `Stack` — one column, one gap, decided once — is the layout. `Grid cols={2}` would only
 * fold back to one column below 700px of VIEWPORT, which says nothing about a 560px
 * container.
 *
 * THE PLAN CARDS ARE `<h2>` AND WERE `<h3>`, WHICH WAS A SKIPPED LEVEL.
 *
 * The page's own heading is the `<h1>` PageHeader renders; the next level down is `<h2>`,
 * and there was nothing in between for the `<h3>`s to be nested under. A screen reader
 * jumping by heading hears the outline of a page, and a jump from level 1 to level 3 tells
 * that reader they have missed a section — so they go back looking for one that does not
 * exist. Nothing about this is visible on screen, which is why it survived: `.card h3` and
 * `.card h2` are near enough in this type scale that the page looks identical either way.
 *
 * Each card also names itself to the accessibility tree: `Card as="section"` with
 * `aria-labelledby` pointing at its own heading, so the region is announced with the
 * heading's words rather than as an anonymous group.
 */
export function PlannedSection({ id }: { id: SectionId }) {
  const section = SECTIONS[id]

  return (
    <FieldShell active={id}>
      <PageHeader
        title={section.label}
        description={section.lede}
        /* A word, not a colour. A coloured dot alone is unreadable to a colour-blind
           rider and invisible to a screen reader. */
        actions={<Badge tone="warn">Not built yet</Badge>}
      />

      <Stack gap="5">
        <Notice>
          Nothing on this screen works yet. The route exists so the tab goes somewhere
          honest instead of a 404 — and so a 404 here comes to mean something has genuinely
          broken, which it could not while both tabs were broken.
        </Notice>

        {section.caution ? <Notice tone="info">{section.caution}</Notice> : null}

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
      </Stack>
    </FieldShell>
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
