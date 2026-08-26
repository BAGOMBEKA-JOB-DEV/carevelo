import { describe, expect, it } from 'vitest'
import {
  confirmedByMethodFrom,
  confirmedByServiceFrom,
  paidForLabel,
  revenueCaveatsFrom,
  serviceHeading,
} from './types'

/**
 * The narrowing that stands between an opaque contract field and a figure on a money screen.
 *
 * ------------------------------------------------------------------
 * WHY THESE FUNCTIONS ARE WORTH TESTING AND MOST PARSERS ARE NOT
 *
 * `GET /v1/revenue` loses three fields in generation — `aggregator_confirmed_total` becomes
 * `Record<string, never>`, and both breakdowns become `unknown[]` — so the compiler checks
 * NOTHING about the values these functions return. They are the only thing standing between
 * a response that changed shape and a number rendered under a heading a clinic owner trusts.
 * Every assertion below is one way that number could be wrong, and each one is silent: none
 * of them throws, none shows up in a type, and all of them render.
 *
 * The rule each test encodes is stated in its name, so a failure says which guarantee broke
 * rather than which line moved.
 */

/** A well-formed amount, in the house shape: whole shillings times one hundred. */
const UGX = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'UGX' })

describe('a by-method row', () => {
  it('reads the amount and the count that the aggregator confirmed', () => {
    expect(
      confirmedByMethodFrom({
        method_recorded: 'mtn_momo',
        aggregator_confirmed_count: 3,
        aggregator_confirmed_total: UGX(9_000_000),
      }),
    ).toEqual({ methodRecorded: 'mtn_momo', count: 3, total: UGX(9_000_000) })
  })

  /*
   * THE FIELD NAME IS THE WHOLE POINT OF THE FIELD. `_recorded` is what WE wrote down when
   * the collection was opened; `_confirmed` is what the aggregator told us. Pesapal returns
   * a payment_method of its own on GetTransactionStatus and nothing stores it, so a parser
   * that fell back to a plain `method` key would quietly reintroduce the claim the backend
   * renamed the field to refuse — and it would do it invisibly, because the row would still
   * render and the number on it would still be right.
   */
  it('refuses a row that names the method as anything but method_recorded', () => {
    expect(
      confirmedByMethodFrom({
        method: 'mtn_momo',
        aggregator_confirmed_count: 3,
        aggregator_confirmed_total: UGX(9_000_000),
      }),
    ).toBeNull()
  })

  /*
   * A row with an unreadable amount is REFUSED rather than rendered with a zero beside a
   * real count. "MTN Mobile Money — 3 payments — UGX 0" is a sentence about a clinic's
   * month that is not true, and it is more damaging than the row being absent, because the
   * absence is counted and reported and the zero is not.
   */
  it('refuses a row whose amount is not money, rather than showing a zero', () => {
    expect(
      confirmedByMethodFrom({
        method_recorded: 'card',
        aggregator_confirmed_count: 2,
        aggregator_confirmed_total: 9_000_000,
      }),
    ).toBeNull()
  })

  it('refuses a count that is not a whole number', () => {
    expect(
      confirmedByMethodFrom({
        method_recorded: 'card',
        aggregator_confirmed_count: 2.5,
        aggregator_confirmed_total: UGX(1),
      }),
    ).toBeNull()
  })

  it('refuses a negative count', () => {
    expect(
      confirmedByMethodFrom({
        method_recorded: 'card',
        aggregator_confirmed_count: -1,
        aggregator_confirmed_total: UGX(1),
      }),
    ).toBeNull()
  })

  it('refuses anything that is not an object', () => {
    expect(confirmedByMethodFrom(null)).toBeNull()
    expect(confirmedByMethodFrom('mtn_momo')).toBeNull()
    expect(confirmedByMethodFrom(undefined)).toBeNull()
  })

  /*
   * A zero is a real answer. A method the clinic offers and nobody used this month is a row
   * worth showing, and a parser that treated zero as absent would drop it — quietly turning
   * "nobody paid by card" into "there is no card at this clinic".
   */
  it('keeps a row whose count and amount are both zero', () => {
    expect(
      confirmedByMethodFrom({
        method_recorded: 'card',
        aggregator_confirmed_count: 0,
        aggregator_confirmed_total: UGX(0),
      }),
    ).toEqual({ methodRecorded: 'card', count: 0, total: UGX(0) })
  })
})

describe('a by-service row', () => {
  it('reads a service that still exists', () => {
    expect(
      confirmedByServiceFrom({
        service_id: '01H9X',
        service_name: 'Antenatal review',
        paid_for: 'appointment',
        aggregator_confirmed_count: 4,
        aggregator_confirmed_total: UGX(12_000_000),
      }),
    ).toEqual({
      serviceId: '01H9X',
      serviceName: 'Antenatal review',
      paidFor: 'appointment',
      count: 4,
      total: UGX(12_000_000),
    })
  })

  /*
   * A NULL SERVICE IS NOT A FAILURE. The API sends both service fields as null with
   * `paid_for` discriminating, because a dispensing order has no bookable service. Refusing
   * the row would drop every shilling of dispensed medicine out of a clinic's breakdown,
   * which is the largest single category at most of these clinics.
   */
  it('keeps a row with no service at all, which is how medicines arrive', () => {
    expect(
      confirmedByServiceFrom({
        service_id: null,
        service_name: null,
        paid_for: 'dispense_order',
        aggregator_confirmed_count: 7,
        aggregator_confirmed_total: UGX(4_500_000),
      }),
    ).toEqual({
      serviceId: null,
      serviceName: null,
      paidFor: 'dispense_order',
      count: 7,
      total: UGX(4_500_000),
    })
  })

  /*
   * An id with no name is a service the clinic has since deleted. It is kept, and the id is
   * kept with it, so the screen can say the service is gone rather than implying the money
   * was never for one.
   */
  it('keeps a deleted service, id and all, so the screen can say it is gone', () => {
    const row = confirmedByServiceFrom({
      service_id: '01H9X',
      service_name: null,
      paid_for: 'appointment',
      aggregator_confirmed_count: 1,
      aggregator_confirmed_total: UGX(3_000_000),
    })

    expect(row?.serviceId).toBe('01H9X')
    expect(row?.serviceName).toBeNull()
  })

  it('refuses a row that does not say what was paid for', () => {
    expect(
      confirmedByServiceFrom({
        service_id: null,
        service_name: null,
        paid_for: '',
        aggregator_confirmed_count: 1,
        aggregator_confirmed_total: UGX(1),
      }),
    ).toBeNull()
  })

  it('refuses a row whose amount is not money', () => {
    expect(
      confirmedByServiceFrom({
        service_id: null,
        service_name: null,
        paid_for: 'dispense_order',
        aggregator_confirmed_count: 1,
        aggregator_confirmed_total: { amount_minor: '300000', currency: 'UGX' },
      }),
    ).toBeNull()
  })
})

describe('the heading a breakdown row is filed under', () => {
  const row = (over: Partial<{ serviceId: string | null; serviceName: string | null; paidFor: string }>) => ({
    serviceId: null,
    serviceName: null,
    paidFor: 'dispense_order',
    count: 1,
    total: UGX(1),
    ...over,
  })

  it('uses the service name where there is one', () => {
    expect(serviceHeading(row({ serviceId: '01H9X', serviceName: 'Antenatal review', paidFor: 'appointment' })))
      .toBe('Antenatal review')
  })

  /*
   * NEVER "OTHER", AND NEVER AN INVENTED SERVICE. The backend argues it: inventing a
   * heading for a dispensing order "would file medicines under a service that doesn't
   * exist". An "Other" bucket does the same damage more quietly, by putting a deleted
   * service and a dispensing order in one row that means neither of them.
   */
  it('files a row with no service under what it was paid for', () => {
    expect(serviceHeading(row({ paidFor: 'dispense_order' }))).toBe('Medicines dispensed')
  })

  it('files a deleted service under what it was paid for rather than under nothing', () => {
    expect(serviceHeading(row({ serviceId: '01H9X', paidFor: 'appointment' }))).toBe('Appointment')
  })

  /*
   * `payable_type` is a hand-rolled string typed `string` in the contract. A value this
   * build has not heard of renders as itself — a category of takings that VANISHED from a
   * breakdown is the failure this screen must not have, and an unfamiliar heading is a
   * question somebody asks rather than money nobody sees.
   */
  it('renders a kind this build has never heard of as itself', () => {
    expect(paidForLabel('lab_order')).toBe('lab_order')
    expect(serviceHeading(row({ paidFor: 'lab_order' }))).toBe('lab_order')
  })
})

describe('the caveats that have to arrive before any figure may be shown', () => {
  const meta = {
    counts: 'Payments the clinic’s own aggregator confirmed as completed.',
    does_not_count: ['attempts nobody confirmed', 'cash handed over at the clinic'],
    not_money_in_the_bank: 'Money never passes through Carevelo and we cannot see the clinic’s bank account.',
  }

  it('reads all three, however long the exclusion list turns out to be', () => {
    expect(revenueCaveatsFrom(meta)).toEqual({
      counts: meta.counts,
      doesNotCount: meta.does_not_count,
      notMoneyInTheBank: meta.not_money_in_the_bank,
    })
  })

  /*
   * THE REFUSAL THAT IS ABOUT COMPLIANCE RATHER THAN ABOUT CORRECTNESS.
   *
   * `not_money_in_the_bank` is the sentence the endpoint exists to keep true, and it is
   * shipped in the payload rather than left in the documentation so that no client can
   * quietly soften it. If it stops arriving, the honest response is a screen that shows
   * nothing — not a screen that draws a month's takings under a reassuring sentence this
   * app made up. The caveat is the condition on which the figure may be shown at all.
   *
   * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
   */
  it('refuses the whole thing when the sentence about the bank account is missing', () => {
    const { not_money_in_the_bank: _dropped, ...withoutTheSentence } = meta

    expect(revenueCaveatsFrom(withoutTheSentence)).toBeNull()
  })

  it('refuses the whole thing when the sentence about the bank account is empty', () => {
    expect(revenueCaveatsFrom({ ...meta, not_money_in_the_bank: '' })).toBeNull()
  })

  it('refuses the whole thing when nothing says what the figure counts', () => {
    expect(revenueCaveatsFrom({ ...meta, counts: '' })).toBeNull()
  })

  /*
   * The contract types this list as a tuple of five exact string literals, which is a
   * generator artefact rather than a promise the API made — the backend is free to add a
   * sixth exclusion. Reading it at runtime is what makes a sixth one appear on screen
   * instead of being silently trimmed to the five this build was compiled against.
   */
  it('carries an exclusion this build has never seen', () => {
    const withASixth = { ...meta, does_not_count: [...meta.does_not_count, 'something added later'] }

    expect(revenueCaveatsFrom(withASixth)?.doesNotCount).toContain('something added later')
  })

  it('drops an exclusion that did not arrive as a sentence rather than rendering an object', () => {
    expect(
      revenueCaveatsFrom({ ...meta, does_not_count: ['a real one', { note: 'not a sentence' }, ''] })
        ?.doesNotCount,
    ).toEqual(['a real one'])
  })

  it('refuses anything that is not an object', () => {
    expect(revenueCaveatsFrom(null)).toBeNull()
    expect(revenueCaveatsFrom(undefined)).toBeNull()
    expect(revenueCaveatsFrom('meta')).toBeNull()
  })
})
