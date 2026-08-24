import type { ReactElement, ReactNode } from 'react'
import { cx } from './classNames'

/**
 * A number with a word above it.
 *
 * THE COUNT THIS RETIRES: 54 hand-written `.stat__label` blocks. The classes have existed
 * in the token layer since the beginning and every screen assembled them by hand, which is
 * how three of them ended up with the label and the value the wrong way round in the DOM —
 * visually identical, because `.stat` is a flex column and the order was set by which line
 * was typed first, and audibly wrong, because a screen reader read "1,240. Patients seen
 * this week" as two unrelated fragments.
 *
 * THE LABEL COMES FIRST IN THE DOM. ALWAYS.
 *
 * That is the point of the component. A bare number is not information — "1,240" announced
 * on its own is a screen reader user's dead end — so the label precedes it here by
 * construction and the props cannot reorder them. The visual order is the reading order is
 * the announcement order, and none of the three is a call site's decision.
 *
 * `value` TAKES A NODE, BECAUSE THE VALUE IS USUALLY NOT A STRING
 *
 * Money and instants are formatted by `<Money>` and `<DateTime>` and must not be
 * re-formatted by hand on the way into a stat — a figure hand-formatted here is a figure
 * that disagrees with the same figure in the table below it. Pass the component.
 *
 * `note` IS WHERE THE COMPARISON GOES, AND IT IS NOT A TREND ARROW. There is no `delta`
 * prop and no green-up/red-down chevron: a coloured arrow is a claim about whether a
 * change is GOOD, and on a clinic's screens "23 more prescriptions than last week" is not
 * obviously either. Say it in words and let the clinic read it.
 *
 * NOT FOR A CLINICAL FIGURE ABOUT ONE PATIENT. A stat is a dashboard object — it is on
 * screen all day at a counter that the next person in the queue can see. Counts of work,
 * never a reading, a dose or a result.
 *
 * @example
 * <Stat label="Waiting to dispense" value={queue.total} note="Oldest has waited 40 minutes" />
 * <Stat label="Collected today" value={<Money value={total} />} />
 */

export type StatProps = {
  /** The word above the number. Required — a bare figure announces as nothing. */
  label: string
  /** The figure. A node, so `<Money>` and `<DateTime>` can do their own formatting. */
  value: ReactNode
  /** The qualifier under it: what it is of, since when, what it excludes. */
  note?: ReactNode | undefined
  className?: string | undefined
}

export function Stat({ label, value, note, className }: StatProps): ReactElement {
  return (
    <div className={cx('stat', className)}>
      <span className="stat__label">{label}</span>
      {/* `.stat__value` sets tabular figures, so a column of these stays aligned digit
          over digit as the numbers change. */}
      <span className="stat__value">{value}</span>
      {note ? <span className="stat__note">{note}</span> : null}
    </div>
  )
}
