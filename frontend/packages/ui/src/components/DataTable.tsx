import type { ReactElement, ReactNode } from 'react'
import { cx } from './classNames'

/**
 * A real `<table>`, with the parts that are easy to forget made impossible to forget.
 *
 * THE COUNT THIS RETIRES: 13 hand-written tables carrying 84 `<th>` elements, of which 15
 * have no `scope`. That is the measurement this component exists for. The rest of the
 * table markup in this product is genuinely good — these are real `<table>`s, not divs
 * pretending, and the `.table-scroll` wrapper is already used — so nothing here replaces
 * that. It removes the four things a person can leave out at four in the afternoon.
 *
 * WHAT IT MAKES IMPOSSIBLE
 *
 * 1. A `<th>` without `scope`. Every header cell this renders is `scope="col"`, and the
 *    one column a caller marks `rowHeader` renders each row's cell as `scope="row"`.
 *    Without scope a screen reader guesses the association from position, and on a table
 *    with a leading action column it guesses wrong — the user hears every cell announced
 *    against the wrong heading, which on a dispensing queue means reading a state against
 *    a reference that is not its own. Nothing in a linter checks this. The type does.
 *
 * 2. A `<th>` with nothing in it. The action column — the one that just says "Open" — was
 *    written as an empty `<th>` in several places, and an empty header is announced as
 *    silence, leaving a keyboard user with no name for the column they have landed in.
 *    `header` is a required string; `headerHidden` renders it to a screen reader only.
 *
 * 3. A table with no caption. `caption` is required and is the sentence that says what
 *    these rows are and how they are ordered — "Oldest first" is not decoration on a
 *    pharmacy queue, it is the reason the top row is the one to work on.
 *
 * 4. A list that renders as an empty table body. `empty` is required and takes the node,
 *    which should almost always be `<EmptyState>` — see that file for why "No results"
 *    on its own is ambiguous between "nothing to do" and "your filter is wrong". It
 *    renders inside the table so the headers and the caption stay put and the page does
 *    not change shape between a full list and an empty one.
 *
 * 5. A page that scrolls sideways. The table lives in `.table-scroll`, which scrolls
 *    within itself. A body that scrolls horizontally on a phone puts the primary action
 *    off the right edge where nobody finds it.
 *
 * THE SCROLL CONTAINER IS FOCUSABLE ON PURPOSE
 *
 * A region that scrolls and cannot be focused cannot be scrolled by anyone who is not
 * holding a mouse — the arrow keys need something focused to act on. So the wrapper takes
 * `tabIndex={0}`, and with it a role and a name, because a bare focusable div is a stop in
 * the tab order that announces nothing when you land on it. The cost is honest: on a table
 * narrow enough not to overflow, this is one extra Tab press. Chrome and Firefox now do
 * this themselves for overflowing containers, but only for overflowing ones, and whether
 * this table overflows depends on the viewport and on the data — neither of which is
 * knowable here, on the server, at render time. One predictable tab stop beats a keyboard
 * trap on the one screen where the columns happened to be wide.
 *
 * `rowKey` IS REQUIRED AND IS NOT THE ARRAY INDEX
 *
 * These lists move. A dispensing queue re-sorts as orders are worked and a filter changes
 * the set entirely; keyed by position, React reuses the DOM row and only patches what
 * changed, so a row that was expanded, focused or mid-`aria-live` announcement carries
 * that state onto a different order. Keyed by id it does not.
 *
 * NOT A GRID. There is no sorting, no selection, no resizing and no virtualisation, and
 * none of them can be added without client JavaScript. If a screen needs sorting, sort it
 * on the server and put the choice in the URL, where it is shareable and survives a
 * refresh.
 *
 * @example
 * <DataTable
 *   caption="Oldest first. The order that has waited longest is the patient wondering."
 *   rows={lane.orders}
 *   rowKey={(order) => order.id}
 *   empty={<EmptyState title="Nothing here" icon="check">{definition.empty}</EmptyState>}
 *   columns={[
 *     { key: 'ref', header: 'Reference', rowHeader: true, cell: (o) => <a className="lnk" href={paths.order(o.id)}>{o.reference}</a> },
 *     { key: 'state', header: 'State', cell: (o) => <Badge tone={present(o.status).tone}>{present(o.status).label}</Badge> },
 *     { key: 'total', header: 'Total', numeric: true, cell: (o) => <Money value={o.total} /> },
 *     { key: 'open', header: 'Open order', headerHidden: true, cell: (o) => <a className="lnk" href={paths.order(o.id)}>Open</a> },
 *   ]}
 * />
 */

export type DataTableColumn<Row> = {
  /** Stable identity for this column. Used as the React key; never shown. */
  key: string
  /** The column heading, in words. Required even when hidden — see `headerHidden`. */
  header: string
  /** This column's cell for one row. */
  cell: (row: Row) => ReactNode
  /**
   * Right-aligned, tabular figures. For money and counts, so digits line up down the
   * column and a change in magnitude is visible rather than merely readable.
   */
  numeric?: boolean | undefined
  /**
   * Render this column's cells as `<th scope="row">` — the value that NAMES the row, so a
   * screen reader can say "Reference DX-4471, State, Awaiting payment" instead of reading
   * a disembodied status. At most one column should carry it; if more than one does, the
   * first wins and the rest are ordinary cells.
   */
  rowHeader?: boolean | undefined
  /**
   * Keep the heading for screen readers and hide it visually. For the action column, whose
   * heading would be visual noise but whose absence is silence.
   */
  headerHidden?: boolean | undefined
}

export type DataTableProps<Row> = {
  /** What these rows are and how they are ordered. Required — see above. */
  caption: string
  /**
   * Hide the caption visually. It still names the table for a screen reader and still
   * names the scroll region. Only when a heading immediately above says the same words.
   */
  captionHidden?: boolean | undefined
  columns: ReadonlyArray<DataTableColumn<Row>>
  rows: ReadonlyArray<Row>
  /** Stable identity per row. Not the index — see above. */
  rowKey: (row: Row) => string
  /** What to show when `rows` is empty. Almost always an `<EmptyState>`. */
  empty: ReactNode
  className?: string | undefined
}

export function DataTable<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowKey,
  empty,
  className,
}: DataTableProps<Row>): ReactElement {
  /* The first column that asked to name the row. Resolved once rather than per row, and
     by key rather than by a boolean on each column, so a second `rowHeader: true` cannot
     produce two `<th scope="row">` in one row — which would leave a screen reader with two
     competing names for it and announce both against every cell. */
  const rowHeaderKey = columns.find((column) => column.rowHeader === true)?.key

  return (
    <div
      className={cx('table-scroll', className)}
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className="table">
        <caption className={captionHidden ? 'sr-only' : 'muted'}>{caption}</caption>

        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(column.numeric === true && 'tnum')}
              >
                {column.headerHidden === true ? (
                  <span className="sr-only">{column.header}</span>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              {/* Spanning every column keeps the table valid and keeps the empty state
                  under the headings rather than beside the first one. */}
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) =>
                  column.key === rowHeaderKey ? (
                    <th
                      key={column.key}
                      scope="row"
                      className={cx(column.numeric === true && 'tnum')}
                    >
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td key={column.key} className={cx(column.numeric === true && 'tnum')}>
                      {column.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
