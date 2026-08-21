import type { components, operations } from '@carevelo/api-client'

/**
 * The shapes this domain reads and writes, every one of them taken from the generated
 * contract rather than described a second time here.
 *
 * @see packages/api-client/src/generated/schema.d.ts — generated from docs/40-api/openapi.yaml
 */

/** A record of a payment ATTEMPT. Note what is absent from it: anything Carevelo holds. */
export type PaymentIntent = components['schemas']['PaymentIntentResource']

/** The receipt. Its payee is the CLINIC; Carevelo appears on it in no role at all. */
export type Receipt = components['schemas']['ReceiptResource']

type CreateBody = operations['v1.payments.store']['requestBody']['content']['application/json']

/** `appointment | dispense_order`, straight off the request contract. */
export type PayableType = CreateBody['payable_type']

/** What is being paid for. The API records an intent against this, not against a person. */
export type Payable = {
  type: PayableType
  id: string
}

/**
 * An amount of money as this API writes it: `{ amount_minor, currency }`, integer minor
 * units, never a fractional number.
 *
 * TAKEN FROM A SIBLING RESOURCE, AND THAT IS DELIBERATE RATHER THAN LAZY. The generator
 * emitted `Record<string, never>` for `PaymentIntentResource.amount` and
 * `ReceiptResource.amount` — an object with no readable properties — because those two
 * resources return the `Money` value object directly (`'amount' => $this->amount`) and the
 * generator could not see through the cast. Every resource that spells the same value out
 * (`Money::of(...)->jsonSerialize()`) IS described, so the shape is in the contract; it is
 * simply attached to a different field. Aliasing it here keeps the single-source rule
 * intact: if the wire format ever changes, this alias changes with it and every use of it
 * stops compiling, which is exactly what a hand-written `{ amount_minor: number }` would
 * not do.
 *
 * @see docs/40-api/api-conventions.md — `{"amount_minor": 15000000, "currency": "UGX"}` is UGX 150,000
 */
export type MoneyAmount = components['schemas']['DispenseOrderResource']['total']

/**
 * Read an amount off a resource whose contract type is opaque.
 *
 * Returns null rather than throwing or guessing a zero: a screen with no amount on it is
 * recoverable, and an amount invented by this function would be a number on a payment page
 * that no part of the system agrees with.
 */
export function moneyFrom(value: unknown): MoneyAmount | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as { amount_minor?: unknown; currency?: unknown }

  if (typeof candidate.amount_minor !== 'number' || typeof candidate.currency !== 'string') {
    return null
  }

  return { amount_minor: candidate.amount_minor, currency: candidate.currency }
}

/**
 * The ways a patient can pay, and the ONE list this domain renders from.
 *
 * `method` is typed `string` in the contract — the backend's PaymentMethod enum is not
 * published in the OpenAPI document — so this is a DISPLAY catalogue, not a wire type, and
 * nothing here may assume the API's value appears in it. Every reader falls back to an
 * "unknown" rendering instead, because a payment screen that throws on an unrecognised
 * method is a patient who cannot find out whether they paid.
 *
 * @see backend/app/Models/PaymentMethod.php
 */
export const PAYMENT_METHODS = ['mtn_momo', 'airtel_money', 'card', 'cash_at_clinic'] as const

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]

export function isKnownMethod(value: string): value is PaymentMethodValue {
  return (PAYMENT_METHODS as readonly string[]).includes(value)
}

/** Mobile money is the asynchronous one: a push to a handset, a PIN, and a wait. */
export function isMobileMoney(method: string): boolean {
  return method === 'mtn_momo' || method === 'airtel_money'
}

/** Cash involves no aggregator at all. A member of staff attests it, and that is audited. */
export function isCash(method: string): boolean {
  return method === 'cash_at_clinic'
}

/**
 * The states an intent can be in.
 *
 * `status` is `string` in the contract for the same reason `method` is, so `statusOf()`
 * narrows and everything else switches on the narrowed value with an `unknown` arm. The
 * arm is not defensive decoration: a status this build has never heard of must render as
 * "we cannot tell", never as paid.
 *
 * @see backend/app/Models/PaymentIntentStatus.php
 */
const KNOWN_STATUSES = [
  'initiated',
  'pending',
  'succeeded',
  'failed',
  'timed_out',
  'reversed',
] as const

export type PaymentStatusValue = (typeof KNOWN_STATUSES)[number] | 'unknown'

export function statusOf(intent: PaymentIntent): PaymentStatusValue {
  return (KNOWN_STATUSES as readonly string[]).includes(intent.status)
    ? (intent.status as PaymentStatusValue)
    : 'unknown'
}

/**
 * Whether the money reached the clinic.
 *
 * EXACTLY ONE STATUS MEANS PAID, and this is the only function allowed to say so. It is
 * written as an equality against `succeeded` rather than as "not one of the bad ones" so
 * that a status added to the backend tomorrow is not-paid here by default. The opposite
 * default — unknown means fine — is how a patient gets told they have paid for a
 * consultation the clinic was never paid for.
 */
export function isPaid(intent: PaymentIntent): boolean {
  return intent.status === 'succeeded'
}

/**
 * Whether an answer may still be coming, which is what makes a screen worth re-checking.
 *
 * `timed_out` is IN this set. It is not a failure: the reconciliation poll goes on asking
 * the aggregator for up to a day afterwards and can still move the intent to `succeeded`.
 * Treating a timeout as final is the single worst outcome available here — a patient
 * charged for a booking we cancelled on their behalf.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md — "a timeout is not an ending"
 */
export function isAwaitingAnswer(intent: PaymentIntent): boolean {
  const status = statusOf(intent)

  return status === 'initiated' || status === 'pending' || status === 'timed_out'
}
