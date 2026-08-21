import type { components, operations } from '@carevelo/api-client'

/**
 * The shapes this domain reads, every one of them taken from the generated contract rather
 * than described a second time here — plus the two places where the contract is provably
 * lossy and something has to stand in for it.
 *
 * ------------------------------------------------------------------
 * ON THE PARSERS BELOW, WHICH LOOK LIKE HAND-WRITTEN API TYPES AND ARE NOT.
 *
 * The house rule is absolute: never hand-write an API type, because a hand-written type is
 * a second copy of the contract that drifts silently. Two fields on the reconciliation
 * response make that impossible to obey literally, and pretending otherwise would be worse
 * than saying so.
 *
 *   `GET /v1/reconciliation` is generated as `data.intents: string[]`. It is not an array
 *   of strings. `ReconciliationController::index()` builds each row with a `->map()` that
 *   returns a plain PHP `array`, and the generator cannot see through an untyped array
 *   literal, so the element type collapsed. Typing the screen against `string[]` would
 *   compile and then render nothing.
 *
 *   `PaymentIntentResource.amount` and `ReceiptResource.amount` are generated as
 *   `Record<string, never>` — an object with no readable properties — because both
 *   resources return the `Money` value object directly and the cast is invisible to the
 *   generator. Every resource that spells the same value out IS described, so the shape is
 *   in the contract; it is simply attached to a different field, and `MoneyAmount` below
 *   aliases it from there.
 *
 * SO THE RULE IS KEPT WHERE IT CAN BE AND ITS PURPOSE IS KEPT WHERE IT CANNOT. Every field
 * the contract does describe is used from the contract. The fields it lost are read at
 * runtime by a parser that CHECKS each one and returns `null` when it is not what was
 * expected. That is the material difference from a hand-written type: a hand-written
 * `{ amount_minor: number }` drifts into a lie the compiler will defend, whereas a row the
 * API stops sending in this shape stops appearing on the screen and says why. On a money
 * screen, "not shown" is a recoverable failure and a wrong number is not.
 *
 * The parsers are also where every unknown value stops. Nothing below trusts `status` or
 * `method` to be a value this build has heard of.
 *
 * @see packages/api-client/src/generated/schema.d.ts — generated from docs/40-api/openapi.yaml
 * @see backend/app/Http/Controllers/Api/V1/ReconciliationController.php
 */

/** A record of a payment ATTEMPT. Note what is absent from it: anything Carevelo holds. */
export type PaymentIntent = components['schemas']['PaymentIntentResource']

/** The receipt. Its payee is the CLINIC; Carevelo appears on it in no role at all. */
export type Receipt = components['schemas']['ReceiptResource']

/**
 * An amount of money as this API writes it: `{ amount_minor, currency }`, integer minor
 * units, never a fractional number. Aliased from the sibling resource that describes it,
 * for the reason given above.
 *
 * @see docs/40-api/api-conventions.md — `{"amount_minor": 15000000, "currency": "UGX"}` is UGX 150,000
 */
export type MoneyAmount = components['schemas']['DispenseOrderResource']['total']

/** The reconciliation response's own envelope, which the generator DID describe. */
type ReconciliationResponse =
  operations['v1.reconciliation.index']['responses'][200]['content']['application/json']

/** `{ total, flagged, note }` — counts of records, never of money. Straight off the contract. */
export type ReconciliationMeta = ReconciliationResponse['meta']

/**
 * Read an amount off a resource whose contract type is opaque.
 *
 * Returns null rather than throwing or guessing a zero: a row with no amount on it is
 * recoverable, and an amount invented by this function would be a number on a
 * reconciliation screen that no part of the system agrees with.
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
 * The states an attempt can be in.
 *
 * `status` is `string` in the contract — the backend's `PaymentIntentStatus` enum is not
 * published in the OpenAPI document — so `statusOf()` narrows and everything else switches
 * on the narrowed value with an `unknown` arm. That arm is not defensive decoration: a
 * status this build has never heard of must render as "we cannot tell", never as paid.
 *
 * @see backend/app/Models/PaymentIntentStatus.php
 */
const KNOWN_STATUSES = ['initiated', 'pending', 'succeeded', 'failed', 'timed_out', 'reversed'] as const

export type PaymentStatusValue = (typeof KNOWN_STATUSES)[number] | 'unknown'

export function statusOf(status: string): PaymentStatusValue {
  return (KNOWN_STATUSES as readonly string[]).includes(status)
    ? (status as PaymentStatusValue)
    : 'unknown'
}

/**
 * Whether the money reached the clinic.
 *
 * EXACTLY ONE STATUS MEANS PAID, and this is the only function in the domain allowed to say
 * so. Written as an equality against `succeeded` rather than as "not one of the bad ones",
 * so a status added to the backend tomorrow is not-paid here by default. The opposite
 * default — unknown means fine — is how a clinic is told it was paid for a consultation
 * nobody paid for.
 */
export function isSucceeded(status: string): boolean {
  return status === 'succeeded'
}

/**
 * Whether an answer may still be coming.
 *
 * `timed_out` IS IN THIS SET. It is not a failure: the reconciliation poll goes on asking
 * the aggregator for up to a day afterwards and can still move the attempt to `succeeded`.
 * A console that treated a timeout as final would have the front desk turning away a
 * patient whose money is on its way.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md — "a timeout is not an ending"
 */
export function isUnresolved(status: string): boolean {
  const known = statusOf(status)

  return known === 'initiated' || known === 'pending' || known === 'timed_out'
}

/**
 * The ways a payment can be taken, and the ONE list this domain renders from.
 *
 * `method` is typed `string` in the contract for the same reason `status` is, so this is a
 * DISPLAY catalogue rather than a wire type and nothing may assume the API's value appears
 * in it. Every reader falls back to the raw value instead, because a payments screen that
 * throws on an unrecognised method is a front desk that cannot find out whether a patient
 * paid.
 *
 * @see backend/app/Models/PaymentMethod.php
 */
export const PAYMENT_METHODS = {
  mtn_momo: 'MTN Mobile Money',
  airtel_money: 'Airtel Money',
  card: 'Card',
  cash_at_clinic: 'Cash at the clinic',
} as const satisfies Record<string, string>

export type PaymentMethodValue = keyof typeof PAYMENT_METHODS

export function methodLabel(method: string): string {
  return method in PAYMENT_METHODS ? PAYMENT_METHODS[method as PaymentMethodValue] : method
}

/**
 * Cash involves no aggregator at all: notes handed to a person standing behind a counter.
 * It is the only method a member of staff may attest, and the API refuses any other —
 * marking an aggregator-backed collection succeeded by hand would let a member of staff
 * assert a payment the aggregator never confirmed, which turns the clinic's own books into
 * fiction and defeats reconciliation.
 */
export function isCash(method: string): boolean {
  return method === 'cash_at_clinic'
}

/**
 * The flags the reconciliation endpoint can raise on a row, and what each one means to the
 * administrator reading it.
 *
 * A CLOSED LIST WITH AN OPEN FALLBACK. The set mirrors `ReconciliationController::flagsFor()`;
 * a flag added there and not here still renders — as its own raw key, under a neutral tone —
 * rather than vanishing. A flag silently dropped from a reconciliation screen is the one
 * failure mode this screen exists to prevent.
 */
export const RECONCILIATION_FLAGS = {
  stuck_pending: {
    label: 'Stuck pending',
    body:
      'Initiated more than an hour ago and still unresolved. The patient does not know '
      + 'whether they paid. Look this reference up in your own aggregator dashboard.',
  },
  timed_out_beyond_window: {
    label: 'Timed out beyond the window',
    body:
      'The prompt went unanswered and the day in which a late success would still have '
      + 'arrived has passed. Treat it as not paid, and confirm against your aggregator '
      + 'before you do anything irreversible.',
  },
  succeeded_without_progression: {
    label: 'Paid, but nothing moved',
    body:
      'The collection succeeded and the appointment or dispense order it was for did not '
      + 'progress. This is the one to look at first: someone has paid for something they '
      + 'have not received.',
  },
  reversed: {
    label: 'Reversed',
    body:
      'The aggregator reversed the collection. Rare, and always handled by a person — '
      + 'Carevelo records that it happened and can do nothing about it.',
  },
  amount_mismatch: {
    label: 'Amount mismatch',
    body:
      'What the aggregator reported did not match what was requested. The attempt was '
      + 'deliberately left exactly as it was rather than accepted; the event recorded at '
      + 'the time is the only record of it.',
  },
} as const satisfies Record<string, { label: string; body: string }>

export type ReconciliationFlag = keyof typeof RECONCILIATION_FLAGS

export function isKnownFlag(flag: string): flag is ReconciliationFlag {
  return flag in RECONCILIATION_FLAGS
}

/**
 * One line of the reconciliation view: an attempt Carevelo recorded, what the aggregator
 * said about it, and whether it looks wrong.
 *
 * Every field is optional-by-absence rather than assumed, because this object is narrowed
 * from an opaque contract field at runtime. `id` and `reference` are the two that must be
 * present for the row to be worth rendering at all — without them an administrator cannot
 * find the transaction anywhere else, which is the entire purpose of the screen.
 */
export type ReconciliationRow = {
  readonly id: string
  readonly reference: string
  /** The line to look for on the clinic's OWN aggregator dashboard. The most useful field here. */
  readonly aggregatorReference: string | null
  readonly status: string
  readonly amount: MoneyAmount | null
  readonly method: string
  readonly initiatedAt: string | null
  readonly resolvedAt: string | null
  readonly flags: readonly string[]
}

export type ReconciliationDay = {
  readonly date: string
  readonly rows: readonly ReconciliationRow[]
  readonly meta: ReconciliationMeta
  /**
   * How many rows the API sent that could not be read in the expected shape.
   *
   * SURFACED RATHER THAN SWALLOWED. A reconciliation screen quietly showing 11 of 12
   * records is worse than one that showed none: the administrator would balance their books
   * against it and never know a line was missing.
   */
  readonly unreadable: number
}

/** A field that must be a non-empty string to be worth anything. */
function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]

  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Narrow one reconciliation row, or refuse it.
 *
 * Returns null on anything that is not an object carrying an id and a reference. See the
 * header: a refused row is counted and reported, never dropped in silence.
 */
export function reconciliationRowFrom(value: unknown): ReconciliationRow | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const source = value as Record<string, unknown>
  const id = stringField(source, 'id')
  const reference = stringField(source, 'reference')

  if (id === null || reference === null) {
    return null
  }

  const flags = Array.isArray(source['flags'])
    ? source['flags'].filter((flag): flag is string => typeof flag === 'string')
    : []

  return {
    id,
    reference,
    aggregatorReference: stringField(source, 'aggregator_reference'),
    // An unreadable status renders through statusOf() as 'unknown', which is the safe
    // rendering. An empty string would too, so no special case is needed here.
    status: stringField(source, 'status') ?? '',
    amount: moneyFrom(source['amount']),
    method: stringField(source, 'method') ?? '',
    initiatedAt: stringField(source, 'initiated_at'),
    resolvedAt: stringField(source, 'resolved_at'),
    flags,
  }
}
