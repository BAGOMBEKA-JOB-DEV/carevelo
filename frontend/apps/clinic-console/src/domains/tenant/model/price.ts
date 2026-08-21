/**
 * A price, between the box the administrator types in and the integer the API stores.
 *
 * ------------------------------------------------------------
 * THE CLINIC TYPES SHILLINGS. THE API STORES MINOR UNITS. NEITHER IS EVER A FLOAT.
 *
 * `Money::ugx()` on the backend is `$wholeShillings * 100`, and `ServiceResource.price`
 * comes back as `{ amount_minor, currency }`. Ugandan shillings have no subunit in
 * everyday use — nobody prices a consultation at 20,000.50 — so the box asks for whole
 * shillings and this file does the only multiplication in the domain.
 *
 * Every step is integer arithmetic. A price that has been through a float cannot be proven
 * correct afterwards, and the backend's own note is blunt about why it stores minor units
 * from the start: the moment a percentage or a fee split lands, floating-point rounding
 * becomes a financial defect rather than a display one.
 *
 * ------------------------------------------------------------
 * AND THE BOX STARTS BLANK. ALWAYS.
 *
 * §H1.4 is explicit: a starter catalogue may be offered pre-filled, but "prices are always
 * blank — guessing a clinic's prices would be presumptuous and wrong". A clinic in Gulu
 * charging 20,000 for a follow-up and one in Kampala charging 60,000 are both correctly
 * configured and Carevelo has no opinion. There is no default in this file for that
 * reason, and `MINOR_UNITS_PER_MAJOR` is the only constant it holds.
 */

/** Two, everywhere in this system. Mirrors `Money`'s own constant. */
const MINOR_UNITS_PER_MAJOR = 100

/** A sanity ceiling, mirroring `ServiceRequest::MAX_PRICE_MINOR`. */
const MAX_PRICE_MINOR = 100_000_000_000

export type PriceReading =
  | { ok: true; minor: number }
  | { ok: false; reason: 'missing' | 'not_a_whole_number' | 'too_large' }

/**
 * Read a typed price.
 *
 * Refused rather than rounded. `1500.50` is not a Ugandan price and `Number()` would
 * happily turn it into 150050 minor units, which is 1,500 shillings and 50 cents — a
 * quantity that does not exist. Whatever the administrator meant, the right answer is to
 * ask rather than to guess, and the API would refuse it anyway: `price_minor` is validated
 * as an integer, so the round trip ends in a 422 with less context than this.
 *
 * Grouping separators are tolerated on the way in, because somebody typing 20,000 has
 * typed a number and telling them otherwise is pedantry. Spaces likewise.
 */
export function priceFromForm(value: string | null): PriceReading {
  const cleaned = (value ?? '').replace(/[,\s]/g, '').trim()

  if (cleaned === '') {
    return { ok: false, reason: 'missing' }
  }

  if (!/^\d+$/.test(cleaned)) {
    return { ok: false, reason: 'not_a_whole_number' }
  }

  const minor = Number(cleaned) * MINOR_UNITS_PER_MAJOR

  if (!Number.isSafeInteger(minor) || minor > MAX_PRICE_MINOR) {
    return { ok: false, reason: 'too_large' }
  }

  return { ok: true, minor }
}

/** The sentence for a price that could not be read. */
export function priceProblem(reason: Exclude<PriceReading, { ok: true }>['reason']): string {
  switch (reason) {
    case 'missing':
      return 'Give the price in Ugandan shillings. A service published without a price becomes '
        + 'an argument at the front desk.'
    case 'not_a_whole_number':
      return 'Give the price as a whole number of shillings — 20000, not 20000.50.'
    case 'too_large':
      return 'That price is larger than any consultation fee. Check for an extra digit.'
  }
}

/**
 * The stored price back in the box, for an edit form.
 *
 * Returns the empty string for a zero, and that is deliberate rather than sloppy: the
 * column is NOT NULL with a zero default, so "priced at nothing" and "never priced" are
 * indistinguishable in the data — and of the two readings, showing a blank box is the one
 * that does not quietly assert a decision the clinic may not have made. A clinic that
 * genuinely offers something free types 0 and means it.
 */
export function priceToForm(amountMinor: number): string {
  if (!Number.isInteger(amountMinor) || amountMinor === 0) {
    return ''
  }

  return String((amountMinor - (amountMinor % MINOR_UNITS_PER_MAJOR)) / MINOR_UNITS_PER_MAJOR)
}
