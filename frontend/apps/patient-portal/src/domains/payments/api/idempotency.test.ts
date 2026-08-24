import { describe, expect, it } from 'vitest'
import { idempotencyKeyFor, type AttemptInput } from './idempotency'

/*
 * The idempotency key, tested as the money-safety property it is.
 *
 * ------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL, WHEN THE FUNCTION IS TWELVE LINES.
 *
 * Every defect this derivation could have is invisible to tsc, to eslint and to a code
 * reviewer skimming it: all four cases below compile, lint clean and read plausibly whether
 * the behaviour is right or wrong. What they cost when wrong is a patient's money — a
 * second MoMo collection against one appointment, which the clinic then has to refund by
 * hand through its own aggregator because Carevelo holds nothing to refund from.
 *
 * So the assertions are about RELATIONSHIPS BETWEEN KEYS rather than about any particular
 * value. Nothing here pins a digest: pinning one would make the SCHEME constant impossible
 * to bump without editing a test that no longer means anything, and the hash output is not
 * the property that protects anybody. The property is which pairs of attempts collide.
 *
 * @see ./idempotency.ts — the argument in full
 * @see docs/10-product/prd-h5-payments-non-custodial.md — "Retry offered with a NEW
 *      idempotency key"
 */

const attempt: AttemptInput = {
  payable: { type: 'dispense_order', id: '01J8XKQ9Z3MOCKORDER0000001' },
  amountMinor: 15_000_00,
  method: 'mtn_momo',
}

describe('idempotencyKeyFor', () => {
  /*
   * THE CASE THE HEADER EXISTS FOR. Two taps on a submit button on a slow connection are
   * two POSTs carrying the identical four fields, and they must derive the identical key so
   * that the second is a replay of the first and the handset is prompted once.
   *
   * A `crypto.randomUUID()` minted per submission — the obvious implementation, and the one
   * the API's own 400 message could be read as suggesting — gets exactly this wrong.
   */
  it('derives the same key for the same attempt, so a double tap is one collection', async () => {
    expect(await idempotencyKeyFor(attempt)).toBe(await idempotencyKeyFor(attempt))
  })

  /*
   * A RETRY IS A NEW ATTEMPT, NOT A REPLAY. `after` carries the id of the attempt being
   * retried, and it has to change the key or the API returns the stored response and the
   * patient is handed back the failure they were trying to escape.
   */
  it('derives a different key once `after` names the attempt being retried', async () => {
    const retried = await idempotencyKeyFor({ ...attempt, after: 'pi_01J8XKQ9Z3' })

    expect(retried).not.toBe(await idempotencyKeyFor(attempt))
  })

  /*
   * And the retry is itself stable across a re-render, which is what stops the double-tap
   * problem simply moving up one level onto the retry screen.
   */
  it('derives a stable key for a retry, so re-rendering the retry does not re-charge', async () => {
    const once = await idempotencyKeyFor({ ...attempt, after: 'pi_01J8XKQ9Z3' })
    const twice = await idempotencyKeyFor({ ...attempt, after: 'pi_01J8XKQ9Z3' })

    expect(once).toBe(twice)
  })

  /*
   * EVERY FIELD THE SERVER FINGERPRINTS IS IN THE MATERIAL, and this is the assertion that
   * keeps `idempotency_key_reused` unreachable from this UI.
   *
   * PaymentIntentController::store hashes exactly `payable_type, payable_id, amount_minor,
   * method` and answers 409 when a key arrives with a body that differs from the one it was
   * stored against. Since the key is a pure function of those same four fields, a differing
   * body implies a differing key — but only while this list stays complete. A field dropped
   * from the derivation would let two genuinely different bodies share a key, and the first
   * symptom would be a 409 on a live payment screen.
   */
  it.each([
    ['the amount', { amountMinor: 9_000_00 }],
    ['the method', { method: 'airtel_money' }],
    ['what is being paid for', { payable: { type: 'appointment', id: attempt.payable.id } }],
    ['which record is being paid for', { payable: { type: attempt.payable.type, id: 'other' } }],
  ] as const)('changes the key when %s changes', async (_label, change) => {
    const changed = await idempotencyKeyFor({ ...attempt, ...change })

    expect(changed).not.toBe(await idempotencyKeyFor(attempt))
  })

  /*
   * THE SHAPE. The API's 400 tells a client to "generate a UUID", and staying inside that
   * shape keeps this value readable in a log line beside keys minted by other clients.
   *
   * Version 8 is RFC 9562's "custom" version — a UUID whose bits come from the author's own
   * scheme, which is precisely what this is. Version 4 would be a false claim of 122 random
   * bits in a payment record where every bit is determined.
   */
  it('is a well-formed version-8 UUID with the RFC 4122 variant', async () => {
    expect(await idempotencyKeyFor(attempt)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
