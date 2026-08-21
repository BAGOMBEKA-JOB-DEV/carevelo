import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { cx } from './classNames'
import { SPACE, type Space } from './space'

/**
 * Things in a row, that wrap rather than overflow.
 *
 * THE COUNT THIS RETIRES: the horizontal share of the 175 hand-set `gap` — every button
 * pair, badge run, filter row and metadata line that was written as
 * `style={{ display: 'flex', gap: 'var(--space-3)' }}` because `.row` in the reset sets
 * one fixed gap and there was nowhere to say a different one.
 *
 * IT WRAPS BY DEFAULT, AND THAT IS THE WHOLE ARGUMENT FOR IT
 *
 * A row of three buttons is fine on a laptop and is a horizontal scrollbar on a 360px
 * phone — which is the screen a clinician between rooms and a patient on a cracked handset
 * are both actually holding. A page that scrolls sideways hides its primary action off the
 * right edge, and nobody discovers this until somebody reports that the Pay button is
 * missing. So `wrap` defaults to true and the row becomes two rows instead. `wrap={false}`
 * exists for the genuinely atomic pair — an icon and its number — where breaking the line
 * would be worse than any overflow.
 *
 * `justify="between"` PUSHES THE LAST CHILD RIGHT, AND IS NOT THE SAME AS A SPACER
 *
 * The reset has `.between` for exactly this and it is one declaration. This component
 * writes `justify-content` directly instead, for all four values, because the alternative
 * is one value carried by a class and three carried by a style property — two mechanisms
 * for one axis, and the next person has to read the source to find out which they are
 * looking at. One mechanism, four values, no class to remember.
 *
 * ORDER IN THE MARKUP IS ORDER IN THE TAB SEQUENCE. There is no `reverse`, and there will
 * not be one: a visual order that disagrees with the DOM order is a keyboard user tabbing
 * backwards through a button row, and it is the most common way a "small CSS fix" becomes
 * an accessibility defect. If the destructive action should sit on the right, write it
 * last.
 *
 * @example
 * <Inline gap="3">
 *   <Button variant="brand" type="submit">Confirm</Button>
 *   <Button variant="quiet" href={paths.back}>Cancel</Button>
 * </Inline>
 *
 * @example
 * <Inline gap="2" align="center">
 *   <Badge tone="warn">Awaiting payment</Badge>
 *   <DateTime value={order.created_at} format="relative" />
 * </Inline>
 */

export type InlineAlign = 'center' | 'start' | 'end' | 'baseline' | 'stretch'

export type InlineJustify = 'start' | 'center' | 'end' | 'between'

export type InlineElement = 'div' | 'span' | 'ul' | 'ol' | 'nav'

export type InlineProps = {
  as?: InlineElement | undefined
  /** A step on the space scale. `3` (8px) suits a button pair; `4` a toolbar. */
  gap?: Space | undefined
  /** Cross-axis. `center` is the default and is what a badge beside a word wants. */
  align?: InlineAlign | undefined
  /** Main axis. `between` pushes the last child to the far edge. */
  justify?: InlineJustify | undefined
  /** Keep it on one line. Only for a pair that would be wrong to break — see above. */
  wrap?: boolean | undefined
  id?: string | undefined
  className?: string | undefined
  'aria-labelledby'?: string | undefined
  'aria-label'?: string | undefined
  children: ReactNode
}

const ALIGN: Record<InlineAlign, string | undefined> = {
  /* `.row` and `.row-wrap` both centre already, so the default says nothing. */
  center: undefined,
  start: 'flex-start',
  end: 'flex-end',
  baseline: 'baseline',
  stretch: 'stretch',
}

const JUSTIFY: Record<InlineJustify, string | undefined> = {
  /* Flexbox's own default. */
  start: undefined,
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
}

export function Inline({
  as: Tag = 'div',
  gap = '4',
  align = 'center',
  justify = 'start',
  wrap = true,
  id,
  className,
  'aria-labelledby': labelledBy,
  'aria-label': label,
  children,
}: InlineProps): ReactElement {
  const list = Tag === 'ul' || Tag === 'ol'

  const style: CSSProperties = {
    gap: SPACE[gap],
    ...(ALIGN[align] === undefined ? {} : { alignItems: ALIGN[align] }),
    ...(JUSTIFY[justify] === undefined ? {} : { justifyContent: JUSTIFY[justify] }),
    /* Same reason as Stack: the reset leaves list markers and indent alone, and a row of
       badges arriving with bullets down the left is not a row of badges. `role="list"`
       goes back on because Safari drops the semantics with the marker. */
    ...(list ? { listStyle: 'none', margin: 0, padding: 0 } : {}),
  }

  return (
    <Tag
      id={id}
      className={cx(wrap ? 'row-wrap' : 'row', className)}
      style={style}
      role={list ? 'list' : undefined}
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      {children}
    </Tag>
  )
}
