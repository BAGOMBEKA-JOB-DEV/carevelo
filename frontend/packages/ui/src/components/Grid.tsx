import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { cx } from './classNames'
import { SPACE, type Space } from './space'

/**
 * Equal columns that collapse on their own.
 *
 * THE COUNT THIS RETIRES: the `style={{ display: 'grid', gridTemplateColumns: 'repeat(3,
 * 1fr)', gap: … }}` sites — the third-largest group inside the 477 inline styles, and the
 * most dangerous one, because a hand-written `repeat(4, 1fr)` has no breakpoints. Four
 * columns on a 360px phone is four 68px columns, and a stat value set in the display face
 * at 28px does not fit in 68px: it wraps to three lines or it overflows. Every collapse
 * below is already written in the token layer. Nothing here invents one.
 *
 * TWO SHAPES, BECAUSE THERE ARE GENUINELY TWO OBJECTS
 *
 * The default is `.grid` with `.g-2/3/4` from the reset: separate children with space
 * between them, collapsing 4→2 and 3→2 at 1080px and everything to a single column at
 * 700px. This is the layout grid. It paints nothing.
 *
 * `panel` is `.cellgrid` from the site layer: ONE bordered, rounded, shadowed container
 * subdivided into flat cells, where the dividers are per-cell box-shadows clipped by the
 * container rather than gaps — which is why a partial last row has a clean edge instead of
 * a stray band of grey. It collapses 4→2 and 3→2 at 960px and to one column at 680px. The
 * apps hand-write those class strings fourteen times today. Its children must each carry
 * `className="cell"`; the container has no way to add it, and without it a child sits on
 * the container's own surface with no divider round it.
 *
 * Two things about `panel` that are deliberately not hidden. It takes no `gap` — the union
 * below will not compile one — because a gap is what its box-shadow dividers exist instead
 * of, and adding one puts a grey stripe through the panel. And it carries a 52px top
 * margin of its own from site.css, tapering to 32px below 768px, because it was written
 * for a marketing section that always follows a heading block. That margin belongs to the
 * layer that owns the class, and quietly zeroing it here would mean this component and the
 * stylesheet disagreeing about a value that is visible on a marketing page. It is the
 * reason `panel` is opt-in rather than the default: a console screen wants the plain grid,
 * inside a Stack that already owns its rhythm.
 *
 * `cols` IS A NUMBER, WHICH THE SPACING PROPS ARE NOT
 *
 * A column count is a count. There are exactly three of them and each maps to a class that
 * exists; `cols={5}` does not compile because there is no `.g-5`, which is the same
 * guarantee the `Space` union gives spacing by a different route.
 *
 * @example
 * <Grid cols={4} gap="5">
 *   {stats.map((s) => <Card key={s.key} padding="tight"><Stat … /></Card>)}
 * </Grid>
 *
 * @example
 * <Grid cols={3} panel as="ul">
 *   <li className="cell">…</li>
 * </Grid>
 */

export type GridColumns = 2 | 3 | 4

export type GridElement = 'div' | 'section' | 'ul' | 'ol'

type GridOwnProps = {
  /** How many columns at full width. Each maps to a class that already exists. */
  cols: GridColumns
  as?: GridElement | undefined
  id?: string | undefined
  className?: string | undefined
  'aria-labelledby'?: string | undefined
  'aria-label'?: string | undefined
  children: ReactNode
}

/*
 * Two arms, discriminated by whether `panel` is DECLARED — the same shape Button uses for
 * `href`, and for the same reason: the plain arm omits the key entirely, so `'panel' in
 * props` narrows on the declaration and `gap` is reachable on exactly one of them.
 */
type GridPlain = GridOwnProps & {
  /** A step on the space scale. Absent from `panel`, which has no gap by design. */
  gap?: Space | undefined
}

type GridPanel = GridOwnProps & { panel: true }

export type GridProps = GridPlain | GridPanel

export function Grid(props: GridProps): ReactElement {
  const {
    cols,
    as: Tag = 'div',
    id,
    className,
    'aria-labelledby': labelledBy,
    'aria-label': label,
    children,
  } = props

  /* `in` rather than a boolean read off a destructured variable: the narrowing has to
     happen on `props` itself for `props.gap` to be reachable at all on the plain arm. */
  const gap = 'panel' in props ? undefined : SPACE[props.gap ?? '5']
  const panel = gap === undefined
  const list = Tag === 'ul' || Tag === 'ol'

  const style: CSSProperties = {
    ...(gap === undefined ? {} : { gap }),
    /* As in Stack: the reset leaves list markers and indent to the user agent, and
       `role="list"` restores the semantics that removing the marker costs in Safari. */
    ...(list ? { listStyle: 'none', margin: 0, padding: 0 } : {}),
  }

  return (
    <Tag
      id={id}
      className={cx(
        panel ? 'cellgrid' : 'grid',
        panel ? `cellgrid--${cols}` : `g-${cols}`,
        className,
      )}
      style={style}
      role={list ? 'list' : undefined}
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      {children}
    </Tag>
  )
}
