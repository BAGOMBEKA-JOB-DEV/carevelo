import type { Payable } from './types'

/**
 * The Idempotency-Key for a payment attempt.
 *
 * ------------------------------------------------------------------
 * THE KEY IS DERIVED, NOT GENERATED AND NOT STORED ANYWHERE.
 *
 * `POST /v1/payment-intents` requires the header and behaves like this
 * (PaymentIntentController::store): the same key with the same body returns the STORED
 * response and executes nothing; the same key with a DIFFERENT body is 409
 * `idempotency_key_reused`, because silently processing that is how money goes missing.
 * The body it fingerprints is exactly `payable_type, payable_id, amount_minor, method`.
 *
 * So the key is a pure function of those four fields plus one nonce, and that single
 * decision answers every hard case without a cookie, a hidden form field, a database row
 * or anything in browser storage:
 *
 * - TWO TAPS ON A SLOW CONNECTION send the same four fields, so they derive the same key,
 *   so the second one is a replay and returns the first attempt. There is exactly one
 *   collection. This is the case the header exists for and it is the one a random
 *   `crypto.randomUUID()` minted per submission would get WRONG — two taps, two keys, two
 *   prompts on the handset.
 * - THE SAME FORM OPEN IN TWO TABS, or re-rendered after a back-navigation, derives the
 *   same key for the same reason. A key minted at render time would not.
 * - CHOOSING A DIFFERENT WAY TO PAY changes `method`, which changes the key, so it can
 *   never collide with the previous attempt's stored body. The 409 is therefore not
 *   reachable from this UI at all: the inputs to this function are precisely the fields
 *   the server fingerprints, so identical inputs imply an identical fingerprint.
 * - A DELIBERATE RETRY passes `after`, and that is the whole mechanism below.
 *
 * ------------------------------------------------------------------
 * WHY `after` IS THE ID OF THE ATTEMPT BEING RETRIED.
 *
 * "Retry uses a NEW idempotency key — a retry is a new attempt, not a replay" is the rule,
 * and the nonce that makes the key new has to be stable across a re-render or the retry
 * screen re-derives a fresh key every time it is drawn, which brings back the double-tap
 * problem one level up. The id of the intent being retried is perfect for it: it exists,
 * it is stable, it is unique, and it is already in the URL of the screen offering the
 * retry. Attempts therefore form a chain — first attempt keyed on `first`, the retry keyed
 * on the id of what it is retrying — and re-submitting any link of that chain replays that
 * link instead of charging again.
 *
 * A patient could of course edit `after` in the address bar and mint a fresh attempt. So
 * could they by pressing "Try another way to pay", which is the same act with a button on
 * it, so nothing is lost. What matters is that no ACCIDENT produces a second collection.
 *
 * ------------------------------------------------------------------
 * WHY A UUID SHAPE, AND WHY VERSION 8.
 *
 * The API's own 400 tells the client to "Generate a UUID and reuse it across retries of
 * the same payment", and staying inside that shape keeps the value readable in a log line
 * beside keys from other clients. It is version 8 — RFC 9562's "custom" version, for a
 * UUID whose bits come from the author's own scheme — because that is what this is. Version
 * 4 would be a lie in a payment record: v4 asserts 122 random bits, and every bit here is
 * determined by the four fields above.
 */

export type AttemptInput = {
  payable: Payable
  /** Integer minor units, as the API prices it. Never typed by a patient. */
  amountMinor: number
  method: string
  /**
   * The id of the attempt this one follows, when the patient chose to try again. Absent
   * for a first attempt.
   */
  after?: string | undefined
}

/**
 * A version tag inside the hashed material. If the derivation ever has to change, bumping
 * this makes every in-flight key change with it rather than colliding with keys minted by
 * the old scheme against a different set of fields.
 */
const SCHEME = 'carevelo.payment-intent.v1'

export async function idempotencyKeyFor(input: AttemptInput): Promise<string> {
  const material = [
    SCHEME,
    input.payable.type,
    input.payable.id,
    String(input.amountMinor),
    input.method,
    input.after ?? 'first',
  ].join('|')

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))

  return uuidV8(new Uint8Array(digest))
}

/**
 * The first 16 bytes of the digest, laid out as a UUID with version 8 and the RFC 4122
 * variant.
 *
 * The nibbles at those two positions are OVERWRITTEN rather than borrowed from the hash,
 * which is what makes the result a well-formed UUID; it costs 6 bits of the 128 and buys
 * a value every tool in the chain will parse.
 */
function uuidV8(bytes: Uint8Array): string {
  const hex = Array.from(bytes.subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')

  // Indexed access is checked under noUncheckedIndexedAccess, and a 32-character string is
  // guaranteed here only by construction — so the fallbacks below are for the compiler
  // rather than for a case that can happen.
  const variantNibble = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}
