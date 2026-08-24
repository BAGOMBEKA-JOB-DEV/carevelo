import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { cx } from './classNames'
import { SPACE, type Space } from './space'

/**
 * Things in a column, with one space between them.
 *
 * THE COUNT THIS RETIRES: 186 hand-set `marginTop`, and the larger part of the 175
 * hand-set `gap`, across the four apps. It is the highest-value component in this layer
 * for a dull reason — almost every one of those 186 was a element being pushed away from
 * the one above it, which is not a property of the element at all. It is a property of the
 * COLUMN. Written as a margin it has to be repeated on every sibling, remembered when a
 * sibling is inserted, and un-remembered on the first child, where it adds a space nobody
 * asked for above the heading. Written here it is set once and cannot be got wrong.
 *
 * The margin version also fails in a way that is hard to see and easy to ship: two stacked
 * elements that each carry `marginTop` do not collapse inside a flex or grid parent, so
 * the space between them is whatever the second one said, while the space above the first
 * is whatever the first one said — and the rhythm of the page is then the sum of decisions
 * nobody made together. `gap` on the container is one decision.
 *
 * WHY IT SETS AN INLINE `gap` RATHER THAN WEARING A CLASS PER STEP
 *
 * `.stack` in the reset gives us the flex column; the gap is written as a style property
 * because the alternative is nine `.gap-*` classes in the token layer that every app
 * downloads in full to use two of them. The value cannot be arbitrary — `Space` is a
 * string union of the eight steps in spacing.css, so a caller cannot reach a pixel — and
 * that is the property that mattered. The mechanism was missing, not the values.
 *
 * `as` IS A SEMANTIC DECISION, NOT A STYLING ONE
 *
 * A column of prescriptions is a `<ul>` and a screen reader should say "list, 6 items"
 * before reading it; a titled region of a page is a `<section>` with an accessible name.
 * Both are stacks. Giving them the same `<div>` because they share a gap is how a screen
 * becomes a wall of unannounced boxes. When `as` is a list, this also strips the browser's
 * bullets and indent AND sets `role="list"` — Safari drops list semantics from an element
 * whose `list-style` is `none`, so removing the marker without restoring the role is how a
 * list stops being announced as one.
 *
 * @example
 * <Stack gap="7">
 *   <PageHeader title="Patients" />
 *   <Toolbar label="Filter patients">…</Toolbar>
 *   <DataTable … />
 * </Stack>
 *
 * @example
 * <Stack as="ul" gap="4" aria-label="Your prescriptions">
 *   {items.map((item) => <Card as="li" key={item.id}>…</Card>)}
 * </Stack>
 */

export type StackElement = 'div' | 'section' | 'article' | 'ul' | 'ol' | 'li' | 'nav'

export type StackAlign = 'stretch' | 'start' | 'center' | 'end'

/*
 * `gap` IS REQUIRED, AND THAT IS NOT AN OVERSIGHT.
 *
 * A default here would be actively dangerous during the sweep this component exists for.
 * `.stack` in reset.css is `gap: var(--space-2)` — 6px — and the obvious default for new
 * code is `'5'`, which is 16px. There are 207 elements carrying `className="stack"` in the
 * apps and only 85 of them state a gap; converting the other 122 to a defaulted `<Stack>`
 * would have TRIPLED their spacing, silently, with no diff to read and nothing failing.
 *
 * Requiring the prop turns that from a regression nobody notices into a decision somebody
 * makes. Converting an existing `.stack` with no inline gap? It was 6px, so `gap="2"`.
 * Writing something new? `gap="5"` is the sensible starting point. Either way the value is
 * on the page, where a reviewer can see it.
 */
export type StackProps = {
  as?: StackElement | undefined
  /** A step on the space scale. `5` (16px) is the page's ordinary paragraph rhythm. */
  gap: Space
  /**
   * Cross-axis alignment. `stretch` is the default and is nearly always right: children
   * fill the column's width, which is what a card, a field and a table all want.
   */
  align?: StackAlign | undefined
  id?: string | undefined
  className?: string | undefined
  'aria-labelledby'?: string | undefined
  'aria-label'?: string | undefined
  children: ReactNode
}

const ALIGN: Record<StackAlign, string | undefined> = {
  /* `stretch` is flexbox's own default, so it is expressed by saying nothing. */
  stretch: undefined,
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
}

/* `flex-start`/`flex-end` rather than the newer `start`/`end`: the two behave identically
   in a flex container and the older pair has no browser floor to check. */

export function Stack({
  as: Tag = 'div',
  gap,
  align = 'stretch',
  id,
  className,
  'aria-labelledby': labelledBy,
  'aria-label': label,
  children,
}: StackProps): ReactElement {
  const list = Tag === 'ul' || Tag === 'ol'

  const style: CSSProperties = {
    gap: SPACE[gap],
    ...(ALIGN[align] === undefined ? {} : { alignItems: ALIGN[align] }),
    /* The reset resets headings and paragraphs but not lists, so a `<ul>` here would
       arrive with the user-agent's bullets and 40px of indent — a layout primitive that
       silently indents its children is a primitive nobody trusts. */
    ...(list ? { listStyle: 'none', margin: 0, padding: 0 } : {}),
  }

  return (
    <Tag
      id={id}
      className={cx('stack', className)}
      style={style}
      role={list ? 'list' : undefined}
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      {children}
    </Tag>
  )
}
