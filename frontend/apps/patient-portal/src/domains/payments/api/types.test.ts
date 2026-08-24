import { describe, expect, it } from 'vitest'
import { isAwaitingAnswer, isPaid, moneyFrom, statusOf, type PaymentIntent } from './types'

/*
 * The three questions this domain is allowed to answer about a payment, and the answers
 * that must not drift.
 *
 * ------------------------------------------------------------------
 * WHAT IS ACTUALLY BEING PROTECTED HERE.
 *
 * `status` is `string` on the wire — the backend's PaymentIntentStatus enum is not published
 * in the OpenAPI document — so nothing in the type system stops a value this build has never
 * heard of reaching these functions. The rules below are therefore enforced by tests or by
 * nothing:
 *
 *  1. EXACTLY ONE STATUS MEANS PAID. Telling a patient they have paid for a consultation the
 *     clinic was never paid for is the worst thing this screen can do.
 *  2. `timed_out` IS NOT A FAILURE. The reconciliation poll goes on asking the aggregator
 *     for up to a day and can still move it to `succeeded`. Rendering it as final failure
 *     produces the other worst outcome: a patient charged for a booking cancelled on our
 *     side.
 *  3. AN UNRECOGNISED STATUS IS NEVER REASSURING. It maps to `unknown`, which renders "we
 *     cannot tell", never a receipt.
 *
 * A test asserting only "succeeded renders as paid" would let all three regress and stay
 * green, so every status the backend defines is enumerated below rather than sampled.
 *
 * @see backend/app/Models/PaymentIntentStatus.php
 * @see docs/10-product/prd-h5-payments-non-custodial.md — "a timeout is not an ending"
 */

/*
 * The wire shape of an amount, which a fixture cannot state directly.
 *
 * The generator emitted `Record<string, never>` — an object with no readable properties —
 * for `PaymentIntentResource.amount`, because the resource returns the backend's Money value
 * object and the generator could not see through the cast (the reasoning is in ./types.ts).
 * That type and the real `{ amount_minor, currency }` genuinely do not overlap, so the
 * assertion has to route through `unknown`. It is the generator's gap being worked around in
 * a fixture, not a fact about the wire being invented here: `moneyFrom` is the production
 * narrowing for the same gap and it is tested on its own below.
 */
const WIRE_AMOUNT = { amount_minor: 15_000_00, currency: 'UGX' } as unknown as PaymentIntent['amount']

/** A resource with the one field under test set, and the rest of the shape honoured. */
function intentWith(status: string): PaymentIntent {
  return {
    id: '01J8XKQ9Z3MOCKINTENT000001',
    reference: 'PAY-2608-0455',
    status,
    amount: WIRE_AMOUNT,
    method: 'mtn_momo',
    aggregator_reference: null,
    // Null is the ordinary answer: only an aggregator whose collection is initiated
    // server-side has a page to send anybody to. Nothing in this file is about that field —
    // `handoffFor` is, and paymentIntents.test.ts is where it is exercised — but the resource
    // requires it, and a fixture that quietly omitted a required field would be a fixture
    // that stops matching the contract without saying so.
    redirect_url: null,
    failure_message: null,
    initiated_at: '2026-08-21T09:00:00+00:00',
    resolved_at: null,
  }
}

/** Every value PaymentIntentStatus defines, so a new one cannot be added silently. */
const BACKEND_STATUSES = [
  'initiated',
  'pending',
  'succeeded',
  'failed',
  'timed_out',
  'reversed',
] as const

describe('statusOf', () => {
  it.each(BACKEND_STATUSES)('passes %s through, because the backend defines it', (status) => {
    expect(statusOf(intentWith(status))).toBe(status)
  })

  /*
   * The status the backend adds next, or a truncated field, or a proxy that mangled the
   * body. All of them land here, and `unknown` is the only honest rendering of any of them.
   */
  it('maps anything it does not recognise to unknown rather than guessing', () => {
    expect(statusOf(intentWith('partially_settled'))).toBe('unknown')
    expect(statusOf(intentWith(''))).toBe('unknown')
  })
})

describe('isPaid', () => {
  it('is true for succeeded and for nothing else the backend defines', () => {
    const paid = BACKEND_STATUSES.filter((status) => isPaid(intentWith(status)))

    expect(paid).toEqual(['succeeded'])
  })

  /*
   * Written as a whole-list assertion rather than as `expect(isPaid(unknown)).toBe(false)`
   * on purpose: this is the test that fails if somebody one day implements "paid" as "not
   * one of the failure states", which is the formulation that turns every future status
   * into a receipt.
   */
  it('is false for a status this build has never heard of', () => {
    expect(isPaid(intentWith('partially_settled'))).toBe(false)
  })
})

describe('isAwaitingAnswer', () => {
  it('includes timed_out, because a late confirmation can still arrive', () => {
    expect(isAwaitingAnswer(intentWith('timed_out'))).toBe(true)
  })

  it('covers exactly the states an answer may still reach', () => {
    const awaiting = BACKEND_STATUSES.filter((status) => isAwaitingAnswer(intentWith(status)))

    expect(awaiting).toEqual(['initiated', 'pending', 'timed_out'])
  })
})

describe('moneyFrom', () => {
  /*
   * The contract types `PaymentIntentResource.amount` opaquely, so this is the narrowing
   * every screen depends on. It must return null rather than a zero: an amount this function
   * invented would be a number on a payment screen that no part of the system agrees with,
   * and the screens render an em dash for null precisely so a gap is visible as a gap.
   */
  it('reads an amount the API sent', () => {
    expect(moneyFrom({ amount_minor: 15_000_00, currency: 'UGX' })).toEqual({
      amount_minor: 15_000_00,
      currency: 'UGX',
    })
  })

  it.each([
    ['null', null],
    ['a string', '15000'],
    ['a bare number, which is the float this API never sends', 150_00],
    ['minor units that arrived as a string', { amount_minor: '1500000', currency: 'UGX' }],
    ['an object with no currency', { amount_minor: 1_500_000 }],
  ])('returns null for %s rather than inventing a figure', (_label, value) => {
    expect(moneyFrom(value)).toBeNull()
  })
})
