import type { ReactElement, ReactNode } from 'react'
import { Inline } from './Inline'
import { cx } from './classNames'

/**
 * The bar above a list: what you are filtering it by, and what you can do to it.
 *
 * THE COUNT THIS RETIRES: the `style={{ display: 'flex', gap: …, justifyContent:
 * 'space-between', flexWrap: 'wrap' }}` above every console list — the second-largest
 * repeated block after `.page-head`, and every one of them anonymous. A `<div>` of three
 * `<select>`s has no accessible name, so a screen-reader user landing on the first control
 * hears "Status, combo box" with nothing to say what it filters, and there may be two such
 * groups on the page.
 *
 * WHY THIS IS NOT `role="toolbar"`
 *
 * It looks like the obvious role and it is the wrong one. The ARIA pattern for a toolbar
 * promises a specific keyboard contract: the whole group is ONE tab stop and the arrow
 * keys move between its controls, which needs a roving `tabindex` and therefore client
 * JavaScript. Nothing in this layer ships JavaScript, and every filter here is a plain
 * `<select>` or `<button>` that a browser already makes reachable by Tab. Declaring
 * `role="toolbar"` would tell a screen reader that arrow keys work, and they would not —
 * an announcement that describes behaviour the page does not have is worse than no
 * announcement, because the user stops looking for the controls they cannot reach. So this
 * is a labelled `group` (or a `form`, below) and Tab behaves exactly as it looks.
 *
 * `label` IS REQUIRED
 *
 * It becomes the group's accessible name — "Filter the pharmacy queue" — which is the
 * sentence that makes the three unlabelled-in-context selects mean something. It is never
 * shown; the visible label of each control is that control's own business, and `<Field>`
 * owns that wiring.
 *
 * `as="form"` FOR A FILTER THAT ACTUALLY FILTERS
 *
 * A console filter is a GET form: it navigates, the URL carries the state, the page is
 * shareable and the back button works. Written as a `<div>` full of inputs it needs an
 * onChange handler, which needs `'use client'`, which spends first-load budget on a
 * feature the browser has had since 1995. Pass `method="get"` and an `action`, and the
 * submit button is the honest one.
 *
 * @example
 * <Toolbar label="Filter the pharmacy queue" as="form" method="get" action={paths.queue}
 *          actions={<Button variant="primary" type="submit">Apply</Button>}>
 *   <Field label="Status" …><Select …/></Field>
 * </Toolbar>
 */

export type ToolbarElement = 'div' | 'form'

export type ToolbarProps = {
  /** The group's accessible name. Announced, never shown. Required — see above. */
  label: string
  /**
   * `form` for a filter that navigates. Pair it with `method="get"` and an `action`, so
   * the filter state lives in the URL rather than in a client component's state.
   */
  as?: ToolbarElement | undefined
  /** Where a `form` submits. Ignored by `div`. */
  action?: string | undefined
  /** `get` for a filter — it navigates and the URL carries the state. */
  method?: 'get' | 'post' | undefined
  /** Pushed to the far edge, and last in the tab order. Submit, export, "New". */
  actions?: ReactNode | undefined
  className?: string | undefined
  /** The filters themselves. Each one still needs its own visible label. */
  children: ReactNode
}

export function Toolbar({
  label,
  as: Tag = 'div',
  action,
  method,
  actions,
  className,
  children,
}: ToolbarProps): ReactElement {
  const form = Tag === 'form'

  return (
    <Tag
      className={cx('row-wrap', 'between', className)}
      /* A `<form>` is already a `form` landmark once it has an accessible name; a `<div>`
         needs a role before `aria-label` is exposed at all — an unlabelled, roleless div
         is invisible to the accessibility tree no matter what is written on it. `group`
         makes no promise about the keyboard, which is exactly what we want. */
      role={form ? undefined : 'group'}
      aria-label={label}
      {...(form && action !== undefined ? { action } : {})}
      {...(form && method !== undefined ? { method } : {})}
    >
      {/* The filters ride in their own row so they wrap among themselves and the actions
          stay together at the far edge, rather than one stray select dropping down beside
          the submit button. `align="end"` sits them on their baseline: a labelled Field is
          taller than a bare Button, and centring the two leaves the button floating. */}
      <Inline gap="4" align="end" className="grow">
        {children}
      </Inline>

      {actions ? (
        <Inline gap="3" align="end">
          {actions}
        </Inline>
      ) : null}
    </Tag>
  )
}
