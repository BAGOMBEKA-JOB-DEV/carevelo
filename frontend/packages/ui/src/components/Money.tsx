import type { ReactElement } from 'react'
import { cx } from './classNames'

/**
 * An amount of money, rendered the way the backend writes it.
 *
 * ------------------------------------------------------------
 * WHAT THE API ACTUALLY SENDS, AND WHY IT IS NOT WHAT YOU EXPECT
 *
 * This was checked against the source rather than assumed, because the obvious assumption
 * is wrong in a way that would be off by a factor of a hundred on every price in the
 * product.
 *
 * `backend/app/Support/Money.php` is the value object. `Money::ugx(150_000)` — a hundred
 * and fifty thousand shillings — constructs `amountMinor = 15_000_000`, because the
 * constructor multiplies by 100. `jsonSerialize()` emits that integer verbatim as
 * `amount_minor`, and `docs/40-api/api-conventions.md` prints the same pair as the
 * canonical example: `{"amount_minor": 15000000, "currency": "UGX"}` is UGX 150,000.
 *
 * So UGX IS STORED WITH TWO MINOR DIGITS even though it has no subunit anybody uses. The
 * comment on the class says why, and it is a good reason: "Ugandan shillings have no
 * subunit in practice, so it is tempting to store whole shillings as a plain integer — but
 * the moment a percentage or fee split lands, floating point rounding becomes a financial
 * defect." Storing minor units from the start means the type never changes and no
 * migration ever reinterprets existing rows.
 *
 * And it is NOT displayed. `Currency::hasSubunitInPractice()` returns false for UGX, and
 * `Money::format()` branches on it: `sprintf('%s %s', 'UGX', number_format(intdiv($minor, 100)))`
 * — currency code, a space, the whole shillings grouped with commas, no decimal point.
 * "UGX 150,000.00" reads as foreign in Kampala. This function reproduces that string
 * exactly, including the two details below.
 *
 * TRUNCATION, NOT ROUNDING. PHP's `intdiv` throws away the remainder. If a fee split ever
 * produces `15_000_050`, the backend prints "UGX 150,000" and a client that divided by 100
 * and asked Intl for zero fraction digits would print "UGX 150,001" — because Intl rounds.
 * Two surfaces disagreeing about a price by one shilling is a support ticket that takes a
 * day to understand. So the split below is integer arithmetic and never touches a
 * fractional value.
 *
 * AN UNKNOWN CURRENCY SHOWS ITS SUBUNIT. `Currency` has exactly one case and expansion is
 * a documented non-goal, so this is a code path that should never run — but if a code we
 * do not know about ever arrives, two decimal places is the safe guess, since almost every
 * other currency has them and silently discarding 99 minor units is the worse failure.
 * Deliberately not `Intl.NumberFormat({ style: 'currency' })`, which would take that
 * decision from CLDR instead of from the backend, and which THROWS on a currency code it
 * does not recognise — a price that crashes the page is not an improvement on a price
 * formatted conservatively.
 *
 * ------------------------------------------------------------
 * NEVER A FLOAT
 *
 * The type says `amount_minor: number` because TypeScript has no integer, so the guard is
 * at runtime and it throws rather than rounding. A fractional `amount_minor` cannot come
 * from the API — the OpenAPI document types it `integer` — so it means a float has entered
 * the money path somewhere in this tree, which is a financial defect and not a rendering
 * one. Rendering a plausible number would bury it; the exception names it. The message
 * carries no amount, because an error string ends up in a log.
 */

/**
 * The shape the OpenAPI document repeats at every price, fee and total.
 *
 * Written out here rather than imported from the generated client on purpose: the API
 * describes it inline at each use rather than as a named schema, so there is nothing to
 * import that is not also a specific resource — and reaching for
 * `DispenseOrderResource['total']` would tie packages/ui to a domain it must not know
 * about. It is structural and it matches; the day it stops matching, every call site that
 * passes a generated type will fail to compile.
 */
export type MoneyValue = {
  amount_minor: number
  currency: string
}

export type MoneyProps = {
  value: MoneyValue
  className?: string | undefined
}

/** Minor units per major unit. Two everywhere in this system — see the note above. */
const MINOR_UNITS_PER_MAJOR = 100

/**
 * Currencies whose subunit is not written down in everyday use. Mirrors
 * `Currency::hasSubunitInPractice()`, inverted: absence from this set means the subunit
 * IS shown, so an unrecognised code errs toward keeping the digits.
 */
const SUBUNIT_NOT_WRITTEN = new Set(['UGX'])

/**
 * Grouping only — no currency style, no fraction digits. The locale is pinned so the
 * separators cannot change with the machine's: PHP's `number_format()` groups in threes
 * with commas, and so does this.
 */
const GROUPING = new Intl.NumberFormat('en-UG', { useGrouping: true, maximumFractionDigits: 0 })

/**
 * The string, for the places a component cannot go: a document title, an `aria-label`, the
 * body of a confirmation sentence.
 */
export function formatMoney({ amount_minor: amountMinor, currency }: MoneyValue): string {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(
      'amount_minor must be a whole number of minor units. A fractional value means a '
        + 'float has entered the money path, which is a defect rather than a display problem.',
    )
  }

  /* Integer arithmetic on the magnitude, so the sign cannot be lost in the split and no
     intermediate is ever fractional. */
  const magnitude = Math.abs(amountMinor)
  const major = (magnitude - (magnitude % MINOR_UNITS_PER_MAJOR)) / MINOR_UNITS_PER_MAJOR
  const minor = magnitude % MINOR_UNITS_PER_MAJOR
  const sign = amountMinor < 0 ? '-' : ''

  const amount = SUBUNIT_NOT_WRITTEN.has(currency)
    ? GROUPING.format(major)
    : `${GROUPING.format(major)}.${String(minor).padStart(2, '0')}`

  return `${currency} ${sign}${amount}`
}

/**
 * @example
 * <Money value={order.total} />        // UGX 150,000
 * <Money value={{ amount_minor: 0, currency: 'UGX' }} />   // UGX 0
 */
export function Money({ value, className }: MoneyProps): ReactElement {
  /* `.tnum` is tabular figures, and it is not cosmetic here: a column of prices whose
     width shifts as digits change is a column that cannot be scanned, and this component's
     commonest home is a column of prices. */
  return <span className={cx('tnum', className)}>{formatMoney(value)}</span>
}
