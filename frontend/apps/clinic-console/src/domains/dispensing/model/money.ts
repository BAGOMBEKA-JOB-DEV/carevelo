/**
 * Turning what a pharmacist types into the integer the API stores.
 *
 * ------------------------------------------------------------
 * TWO FACTS THAT LOOK LIKE ONE AND ARE NOT.
 *
 * `backend/app/Support/Money.php` stores UGX with two minor digits: `Money::ugx(150_000)`
 * — a hundred and fifty thousand shillings — holds `amountMinor = 15_000_000`. The comment
 * on the class explains why, and it is a good reason: "Ugandan shillings have no subunit
 * in practice, so it is tempting to store whole shillings as a plain integer — but the
 * moment a percentage or fee split lands, floating point rounding becomes a financial
 * defect."
 *
 * And it is NOT displayed. `Currency::hasSubunitInPractice()` is false for UGX, so
 * `Money::format()` prints "UGX 150,000" with no decimal point, and `<Money>` in
 * packages/ui reproduces that exactly.
 *
 * So a pharmacist types 150000 and the API must receive 15000000. That single ×100 is the
 * whole job of this file, and it is a file rather than an inline expression because
 * getting it wrong is wrong by a factor of a hundred on every price in the pharmacy, in
 * the direction that overcharges.
 *
 * ------------------------------------------------------------
 * NEVER A FLOAT, AND NEVER A ROUND.
 *
 * `PriceDispenseOrderRequest` validates `unit_price_minor` as `integer`, and there is no
 * field in the whole payload that accepts a decimal. So a typed value with a decimal point
 * is refused here rather than rounded: rounding would silently change a price the clinic
 * set, and the clinic sets its own prices. The same reasoning as `formatMoney`'s runtime
 * guard, one step earlier — that one catches a float that already got in, this one stops
 * it entering.
 */

/** Minor units per major unit. Two everywhere in this system — see above. */
const MINOR_UNITS_PER_MAJOR = 100

/**
 * The largest price this form accepts, in whole shillings.
 *
 * Ten billion shillings is roughly two and a half million US dollars for one line of one
 * prescription, so anything above it is a typing slip rather than a price. The cap exists
 * because the product of price and quantity is summed into a subtotal, and
 * `Number.MAX_SAFE_INTEGER` is where JavaScript integers stop being exact — a total that
 * silently loses precision is the worst possible failure in a money path. This leaves
 * about six orders of magnitude of headroom.
 */
const MAX_WHOLE_SHILLINGS = 10_000_000_000

export type ParsedPrice =
  | { ok: true; minor: number }
  | { ok: false; reason: 'empty' | 'not_a_whole_number' | 'negative' | 'too_large' }

/**
 * A price typed in whole shillings, as minor units.
 *
 * Accepts what a person actually types — spaces, commas as thousands separators — and
 * refuses everything else outright. It does not "do its best" with `1,5.00`: a price the
 * pharmacist did not mean is worse on this screen than a form that will not submit.
 */
export function parseWholeShillings(raw: string): ParsedPrice {
  const trimmed = raw.trim().replace(/[\s,]/g, '')

  if (trimmed === '') {
    return { ok: false, reason: 'empty' }
  }

  if (trimmed.startsWith('-')) {
    return { ok: false, reason: 'negative' }
  }

  // Digits only. A decimal point is rejected rather than truncated — see above.
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, reason: 'not_a_whole_number' }
  }

  const shillings = Number(trimmed)

  if (!Number.isSafeInteger(shillings) || shillings > MAX_WHOLE_SHILLINGS) {
    return { ok: false, reason: 'too_large' }
  }

  return { ok: true, minor: shillings * MINOR_UNITS_PER_MAJOR }
}

/**
 * A quantity, which is a count and not money.
 *
 * `quantity_dispensed` is `integer|min:0`, and zero is legitimate: a line recorded as
 * unfulfilled still has to be sent, with a reason, because an item left out of the payload
 * is refused by the controller — "an item left out is one the patient is never told they
 * did not receive."
 */
export function parseQuantity(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim()

  if (!/^\d+$/.test(trimmed)) {
    return { ok: false }
  }

  const value = Number(trimmed)

  return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false }
}

/**
 * Minor units back to whole shillings, for re-filling a form the pharmacist already
 * submitted once.
 *
 * TRUNCATION, NOT ROUNDING, to match `intdiv` on the backend. The remainder cannot be
 * non-zero for anything this form produced, but a repriced order may carry an amount from
 * somewhere else, and two surfaces disagreeing by one shilling is a support ticket that
 * takes a day to understand.
 */
export function toWholeShillings(minor: number): number {
  const magnitude = Math.abs(minor)

  return Math.sign(minor) * ((magnitude - (magnitude % MINOR_UNITS_PER_MAJOR)) / MINOR_UNITS_PER_MAJOR)
}
