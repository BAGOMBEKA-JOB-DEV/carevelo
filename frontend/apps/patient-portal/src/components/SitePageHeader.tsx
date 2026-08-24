import type { ReactElement, ReactNode } from 'react'
import { Stack } from '@carevelo/ui'

/**
 * The top of a patient-facing screen: what this page is, and the thing you came here to
 * press.
 *
 * THE COUNT THIS RETIRES: 10 hand-rolled `.page-head` blocks in this app, and with them 8
 * copies of `style={{ marginTop: 'var(--space-4)' }}` on an `<h1>` and 6 of
 * `style={{ flex: '1 1 auto' }}` on the div beside the actions.
 *
 * WHY THIS EXISTS WHEN packages/ui ALREADY HAS `PageHeader`
 *
 * This is the important paragraph, and it is the reason the obvious change here would have
 * been a white-label regression.
 *
 * `PageHeader` renders its eyebrow as `<span className="eyebrow">` — the console's eyebrow:
 * 12px uppercase in `--ink-faint`, and nothing else. The patient surface uses
 * `.site-eyebrow`, which is a different element in one load-bearing respect: it carries a
 * 7px `::before` square painted `var(--brand-primary)`. That square is the clinic's colour
 * on the page, and on most of these screens it is the ONLY place the clinic's colour
 * appears above the fold. `PageHeader` has no prop that would change the class, so routing
 * these ten screens through it would have silently deleted the clinic's accent from every
 * patient page heading in the product — a real loss on the surface whose entire proposition
 * is that it belongs to the clinic rather than to us.
 *
 * (`.site-eyebrow`'s own comment explains why the SQUARE carries the brand and the TEXT
 * does not: the backend guarantees contrast for the brand/brand-foreground pairing, not for
 * the brand colour used as 12px uppercase text on white, which is the most
 * contrast-fragile text on the page. This component inherits that reasoning by using the
 * class rather than reimplementing it.)
 *
 * So: same contract as `PageHeader`, same guarantees, different eyebrow. Where the two
 * agree they agree deliberately, and the shared parts of the argument are not repeated
 * here — read `packages/ui/src/components/PageHeader.tsx` for them.
 *
 * EXACTLY ONE `<h1>`, BY CONSTRUCTION
 *
 * `title` is a `string` and renders as an `<h1>`. There is no `as`, no `level`, and no way
 * to pass a node that could contain a heading of its own, which is the whole reason the
 * component is worth its file: a screen-reader user's first move on an unfamiliar page is
 * to jump by heading, and a page with two `<h1>`s has no top level while a page with none
 * reads as a fragment of something else. It follows that a page has ONE of these; a second
 * titled region is a `<Card as="section">` with an `<h2>` inside it.
 *
 * NO INLINE STYLE ANYWHERE IN IT, WHICH IS THE POINT OF THE SWEEP
 *
 * The eyebrow-to-title distance was 12px of hand-set `marginTop` at every call site. It is
 * a `<Stack gap="4">` here — one decision, on the scale, in one place. The title-to-
 * description distance is not set at all: `.page-head p` in the token layer already owns
 * that paragraph's size, colour and the 6px above it, so the description sits OUTSIDE the
 * Stack where that rule still reaches it. Putting it inside would have added the Stack's
 * gap on top of a margin the stylesheet was already applying, and loosened all ten screens
 * by 12px for no reason anybody could have found later.
 *
 * `align="start"` on the Stack because `.site-eyebrow` is `inline-flex` and a flex column
 * stretches its children by default; without it the eyebrow becomes a full-width row and
 * its focus and hover geometry stop matching its ink.
 *
 * @see packages/ui/src/components/PageHeader.tsx — the console's equivalent, and the
 *      shared reasoning about `<h1>`, the `actions` slot and the tab order
 * @see packages/ui/src/tokens/site.css — `.page-head`, `.site-eyebrow` and the brand square
 */

export type SitePageHeaderProps = {
  /** The page's own words, as an `<h1>`. A string, so it cannot contain a heading. */
  title: string
  /** Where this page sits. Rendered with the clinic's brand square beside it. */
  eyebrow?: string | undefined
  /**
   * One or two sentences: what this screen is for, or what it deliberately is not. A node
   * rather than a string, because several of these carry a `<DateTime>` or a `.tnum` span
   * — a reference number formatted by hand here is one that disagrees with the same
   * number in the table below it.
   */
  description?: ReactNode | undefined
  /** Buttons, a badge, a small form. Rendered to the far edge, and last in the tab order. */
  actions?: ReactNode | undefined
  /** Put on the `<h1>`, for a landmark below to point `aria-labelledby` at. */
  id?: string | undefined
  className?: string | undefined
}

export function SitePageHeader({
  title,
  eyebrow,
  description,
  actions,
  id,
  className,
}: SitePageHeaderProps): ReactElement {
  return (
    <div className={className === undefined ? 'page-head' : `page-head ${className}`}>
      {/* `.grow` takes the remaining width so `actions` is pushed to the far edge, and the
          `min-width: 0` it sets is what lets a long title wrap instead of forcing the row
          wider than the content column. */}
      <div className="grow">
        <Stack gap="4" align="start">
          {eyebrow === undefined ? null : <span className="site-eyebrow">{eyebrow}</span>}
          <h1 id={id}>{title}</h1>
        </Stack>

        {/* Outside the Stack on purpose — `.page-head p` already owns the space above it.
            See the docblock. */}
        {description === undefined ? null : <p>{description}</p>}
      </div>

      {actions}
    </div>
  )
}
