import type { ReactElement, ReactNode } from 'react'
import { cx } from './classNames'

/**
 * The top of a screen: what this page is, and the thing you came here to press.
 *
 * THE COUNT THIS RETIRES: 45 hand-rolled `.page-head` blocks across 43 files. Every one of
 * them is the same six lines — a wrapper, a `.grow` div, an `<h1>`, a `<p>`, a button —
 * and having written it 45 times we have 45 chances to have got one of them wrong. Two
 * were: an `<h2>` where the `<h1>` should be, and a description that sat outside `.grow`
 * so the button was pushed onto its own line at every width.
 *
 * EXACTLY ONE `<h1>`, BY CONSTRUCTION
 *
 * `title` is a string and it renders as an `<h1>`. There is no `as`, no `level`, and no
 * way to pass a node that might contain a heading of its own. That is the whole reason
 * this component is worth its file: the first thing a screen-reader user does on an
 * unfamiliar page is jump by heading, and a page with two `<h1>`s has no top level while a
 * page with none starts at `<h2>` and reads as a fragment of something else. A component
 * that takes `title: string` cannot produce either.
 *
 * It follows that a page has ONE of these. A second PageHeader is a second `<h1>` and the
 * type system cannot see it — if a screen has two titled regions, the second is a
 * `<Card as="section">` with an `<h2>` inside it.
 *
 * WHAT `id` IS FOR
 *
 * Pass it and the `<h1>` gets that id, so a `<main aria-labelledby>` or a `<section>`
 * below can borrow the page's own words for its accessible name rather than repeating them
 * in an `aria-label` that then drifts when the title is edited.
 *
 * `actions` IS A SLOT AND NOT A `Button` PROP
 *
 * Half the screens want one button, several want a button and a link, one wants a filter
 * form. A `primaryAction={{ label, href }}` prop would serve the first case and be worked
 * around by the rest, so the slot takes nodes. It sits after the title in the DOM, which
 * is also where it sits in the tab order — see Inline for why those two are never allowed
 * to disagree.
 *
 * @example
 * <PageHeader
 *   eyebrow="Dispensing"
 *   title="Pharmacy queue"
 *   description="Oldest first. The order that has waited longest is the patient wondering."
 *   actions={<Button href={paths.register}><Icon name="user" /> Register a patient</Button>}
 * />
 */

export type PageHeaderProps = {
  /** The page's own words, as an `<h1>`. A string, so it cannot contain a heading. */
  title: string
  /** Where this page sits — the section above it in the navigation, usually. */
  eyebrow?: string | undefined
  /** One or two sentences. What this screen is for, or what it deliberately is not. */
  description?: ReactNode | undefined
  /** Buttons, a link, a small form. Rendered to the right, and last in the tab order. */
  actions?: ReactNode | undefined
  /** Put on the `<h1>`, for a landmark below to point `aria-labelledby` at. */
  id?: string | undefined
  className?: string | undefined
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  id,
  className,
}: PageHeaderProps): ReactElement {
  return (
    <div className={cx('page-head', className)}>
      {/* `.grow` takes the remaining width so `actions` is pushed to the far edge, and
          `min-width: 0` on it — which `.grow` sets — is what lets a long title wrap
          instead of forcing the row wider than the content column. */}
      <div className="grow">
        {eyebrow ? (
          /* `.eyebrow` is inline by default, which is right where it labels something on
             the same line and wrong here. One spacing decision and one display decision,
             both fixed and neither reachable by a caller, so they are cheaper as a style
             property than as a `.page-head .eyebrow` rule every app downloads — the same
             trade EmptyState makes for its action's margin. */
          <span className="eyebrow" style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
            {eyebrow}
          </span>
        ) : null}

        <h1 id={id}>{title}</h1>

        {/* `.page-head p` in the token layer already owns this paragraph's size, colour
            and the space above it. Nothing to set here. */}
        {description ? <p>{description}</p> : null}
      </div>

      {actions}
    </div>
  )
}
