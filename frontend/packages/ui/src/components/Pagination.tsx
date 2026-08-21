import type { ReactElement, ReactNode } from 'react'
import { Icon } from '../icons/Icon'
import { Button } from './Button'
import { Inline } from './Inline'
import { cx } from './classNames'

/**
 * Next and previous, by cursor. There are no page numbers and there cannot be.
 *
 * THE COUNT THIS RETIRES: none yet, and that is the point of building it. There is no
 * pager anywhere in the product — QueueLane says so in its own comment and explains why it
 * refused to write one: the API it reads pages by offset, the house rule is cursor, and
 * rather than page a live queue by position it makes one bounded request and tells the
 * pharmacist out loud that there are more. That was the right call with nothing to reach
 * for. This is the thing to reach for.
 *
 * WHY THERE IS NO `page` PROP, AND WHY THAT IS NOT AN OMISSION
 *
 * docs/40-api/api-conventions.md: pagination is cursor-based, cursors are opaque, default
 * 25 and maximum 100. The reason is written there too — offset paging is unstable while
 * rows are being inserted, and a pharmacist paging through a queue as orders arrive will
 * see duplicates and SKIP items. A skipped item on that screen is an order nobody
 * dispenses; the patient is sitting in the waiting room.
 *
 * So this component takes two hrefs and nothing else. It cannot render "page 3 of 12"
 * because a cursor stream does not know how many pages there are, and it cannot be handed
 * an offset because there is no prop that would accept one. A future `?page=3` cannot be
 * introduced by editing a call site; it would have to be introduced by editing this file,
 * past this paragraph.
 *
 * THE CALLER BUILDS THE HREFS, FROM `meta.next_cursor`
 *
 * `nextHref` is the current URL with `cursor=<meta.next_cursor>`. Absent — because
 * `meta.has_more` was false — the control renders as a disabled `<button>`, which is a
 * real disabled control that a screen reader announces as unavailable. Never a disabled
 * `<a>`: an anchor with no href is still in the accessibility tree as a link, and one with
 * `aria-disabled` is still followable. Button's own docblock makes the same argument.
 *
 * `previousHref` is the cursor the caller arrived on, which means the caller has to carry
 * it — usually as a second query parameter. That is genuinely more work than an offset,
 * and it is the price of a list that does not lose rows. If a surface cannot carry it,
 * omit it: forward-only paging with no back button is honest, and the browser's own back
 * button still works because every page here is a real navigation.
 *
 * IT IS A `<nav>` WITH A NAME. A page can have two of these — one over a table and one
 * under it — and "navigation" announced twice with no distinguishing name is a screen
 * reader user guessing which they are in. `label` says which list this pages.
 *
 * @example
 * <Pagination
 *   label="Dispensing queue pages"
 *   summary={<>Showing {orders.length} of {meta.total} orders</>}
 *   previousHref={previous ? `${paths.queue}?cursor=${previous}` : undefined}
 *   nextHref={meta.has_more ? `${paths.queue}?cursor=${meta.next_cursor}` : undefined}
 * />
 */

export type PaginationProps = {
  /** Which list this pages. Announced as the nav's name, never shown. */
  label: string
  /** The current URL carrying `cursor=<meta.next_cursor>`. Absent when `has_more` is false. */
  nextHref?: string | undefined
  /** The cursor this page was reached by. Absent on the first page, and on forward-only lists. */
  previousHref?: string | undefined
  /** What is on screen, in words. Not a page number — a cursor stream has none. */
  summary?: ReactNode | undefined
  className?: string | undefined
}

export function Pagination({
  label,
  nextHref,
  previousHref,
  summary,
  className,
}: PaginationProps): ReactElement | null {
  /* One page, nothing to page. Rendering two dead buttons under a short list is furniture
     that says "there is more here" to someone scanning, and there is not. */
  if (nextHref === undefined && previousHref === undefined) return null

  return (
    <nav className={cx(className)} aria-label={label}>
      <Inline gap="4" justify="between">
        {/* Rendered even when empty so the two controls keep their edges: `justify="between"`
            needs something on the left or "Next" walks to the middle when the summary is
            absent. `.muted` matches the caption under a table. */}
        <span className="muted grow">{summary}</span>

        <Inline gap="3" wrap={false}>
          {previousHref === undefined ? (
            <Button disabled>
              <Icon name="chevLeft" /> Previous
            </Button>
          ) : (
            <Button href={previousHref} rel="prev">
              <Icon name="chevLeft" /> Previous
            </Button>
          )}

          {nextHref === undefined ? (
            <Button disabled>
              Next <Icon name="chevRight" />
            </Button>
          ) : (
            <Button href={nextHref} rel="next">
              Next <Icon name="chevRight" />
            </Button>
          )}
        </Inline>
      </Inline>
    </nav>
  )
}
