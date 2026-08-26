import type { components, operations } from '@carevelo/api-client'

/**
 * The shapes this domain reads, every one of them taken from the generated contract rather
 * than described a second time here — plus the places where the contract is provably lossy
 * and something has to stand in for it.
 *
 * ------------------------------------------------------------------
 * ON THE PARSERS BELOW, WHICH LOOK LIKE HAND-WRITTEN API TYPES AND ARE NOT.
 *
 * The house rule is absolute: never hand-write an API type, because a hand-written type is
 * a second copy of the contract that drifts silently. Several fields across the
 * reconciliation and revenue responses make that impossible to obey literally, and
 * pretending otherwise would be worse than saying so.
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
 *   `GET /v1/revenue` loses THREE fields to the same two causes, and it loses them on the
 *   one screen in this product where a number must never be wrong.
 *   `AggregatorConfirmedPaymentsResource.aggregator_confirmed_total` is
 *   `Record<string, never>` because it returns `Money::of(...)` rather than the
 *   `->jsonSerialize()` that `DispenseOrderResource` calls — the same cast, invisible in
 *   the same way. `by_method_recorded` and `by_service` are `unknown[]` because both are
 *   built by `array_map` over a closure returning a plain PHP array, which is the
 *   `->map()` problem again. The one-line fix is in the backend resource and is reported
 *   in the handover rather than reached for from here; a frontend agent editing a
 *   compliance-reviewed resource to make its own screen typecheck is how a contract stops
 *   meaning anything.
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
 * @see backend/app/Http/Resources/V1/AggregatorConfirmedPaymentsResource.php
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

/* ==================================================================
   WHAT THE CLINIC'S OWN AGGREGATOR CONFIRMED — `GET /v1/revenue`
   ================================================================== */

/**
 * The revenue response's envelope, which the generator DID describe in full.
 *
 * `meta` is the important half and it survived generation intact, which matters more here
 * than anywhere else in this domain: `not_money_in_the_bank` is the sentence the endpoint
 * exists to keep true, and it is shipped in the payload rather than left in the
 * documentation precisely so the screen renders the API's words and not a paraphrase
 * written here that could drift away from them.
 */
type RevenueResponse = operations['v1.revenue.index']['responses'][200]['content']['application/json']

/**
 * The caveats, in the API's own words.
 *
 * ALL THREE SENTENCES ARE RENDERED FROM THE PAYLOAD AND NONE IS RESTATED HERE. The backend
 * put them on the wire rather than only in its documentation for exactly this reason — "the
 * payload is what a clinic owner's screen is built from, and a caveat nobody ships is a
 * caveat nobody reads" — so a paraphrase written in this file would be the second copy that
 * whole argument exists to prevent.
 *
 * `doesNotCount` IS RE-READ AT RUNTIME RATHER THAN TRUSTED, despite the contract typing it
 * as a tuple of five exact string literals. That tuple is a generator artefact: it inlined
 * `AggregatorConfirmedPaymentsResource::DOES_NOT_COUNT` as a literal type, which is a
 * promise the API never made. The backend is free to add a sixth exclusion, and on the day
 * it does, a screen holding five fixed strings would show five of six — an unlisted
 * exclusion being a figure an administrator goes on trusting for a reason that has stopped
 * being true. So it is narrowed to `string[]` and rendered however long it turns out to be.
 */
export type RevenueCaveats = {
  /** What the figure IS. One sentence, and the only positive claim on the screen. */
  readonly counts: string
  /** What it is not. Deliberately no numbers — see the resource. */
  readonly doesNotCount: readonly string[]
  /** The sentence the whole endpoint exists to keep true. Never abridged, never rewritten. */
  readonly notMoneyInTheBank: string
}

/** The generated envelope, kept so the field names above are checked against the contract. */
export type RevenueMeta = RevenueResponse['meta']

/** One row of "how the collection was opened", which is OURS to say and not the aggregator's. */
export type ConfirmedByMethod = {
  /** `_recorded`, never `_confirmed`. See the note on the naming rule below. */
  readonly methodRecorded: string
  readonly count: number
  readonly total: MoneyAmount
}

/** One row of "what was paid for". */
export type ConfirmedByService = {
  /**
   * Null when the confirmed payment was not for a bookable service — a dispensing order has
   * none — or when the service row it named no longer exists. Null is not zero and is not
   * "other"; `paidFor` says which of the two it was.
   */
  readonly serviceId: string | null
  readonly serviceName: string | null
  /** `appointment` or `dispense_order`. A display catalogue with an open fallback; see below. */
  readonly paidFor: string
  readonly count: number
  readonly total: MoneyAmount
}

/**
 * One window of confirmations, narrowed.
 *
 * EVERY FIELD NAME KEEPS THE API'S DISTINCTION and none of them is shortened on the way in.
 * The wire says `aggregator_confirmed_total` rather than `total` because the key is what
 * carries the caveat when a value is read in isolation, and a client that renamed it
 * `total` on arrival would throw away the one thing the backend spent a resource docblock
 * protecting. So `total` here is only ever reached through a value typed
 * `AggregatorConfirmedPayments`, whose own name says whose observation it is.
 *
 * `total` IS NULLABLE AND IS NEVER RECOMPUTED. If the amount does not arrive in the shape
 * this build expects, the screen says it cannot show the figure. It does not add up the
 * breakdown rows instead: the breakdown is ONE CURSOR PAGE of services and the total is
 * computed by the database over the whole window, so they are not the same quantity and
 * summing the visible rows would produce a smaller number that looks exactly as
 * authoritative. There is no arithmetic on money in this browser.
 */
export type AggregatorConfirmedPayments = {
  /** The window is over CONFIRMATIONS, not bookings. Bare `YYYY-MM-DD` in the clinic's own days. */
  readonly confirmedFrom: string
  readonly confirmedTo: string
  /** Stated by the API rather than assumed, so the dates and the figure cannot disagree. */
  readonly clinicTimezone: string
  readonly count: number
  readonly total: MoneyAmount | null
  readonly byMethodRecorded: readonly ConfirmedByMethod[]
  readonly byService: readonly ConfirmedByService[]
  /**
   * Rows the API sent that could not be read in the expected shape, counted per breakdown.
   *
   * SURFACED, NEVER SWALLOWED — the same rule the reconciliation day follows and for a
   * sharper reason. A breakdown quietly missing one service is a breakdown an owner reads
   * as "that service took nothing this month", which is a decision about a service line.
   */
  readonly unreadableMethodRows: number
  readonly unreadableServiceRows: number
  readonly caveats: RevenueCaveats
  /** Opaque, produced only by this endpoint, and the only way to the next page of services. */
  readonly byServiceNextCursor: string | null
}

/**
 * The caveats as the API sent them, or nothing at all.
 *
 * RETURNS NULL RATHER THAN A DEFAULT SENTENCE, and this is the one refusal in this file
 * that is about compliance rather than about correctness. If the API stops sending
 * `not_money_in_the_bank`, the honest response is a screen that says it cannot show the
 * figures — not a screen that draws them under a reassuring sentence this app made up. The
 * caveat is not decoration around the number; it is the condition on which the number may
 * be shown at all.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
export function revenueCaveatsFrom(value: unknown): RevenueCaveats | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const source = value as Record<string, unknown>
  const counts = source['counts']
  const notMoneyInTheBank = source['not_money_in_the_bank']
  const doesNotCount = source['does_not_count']

  if (typeof counts !== 'string' || counts === '') {
    return null
  }

  if (typeof notMoneyInTheBank !== 'string' || notMoneyInTheBank === '') {
    return null
  }

  return {
    counts,
    // An exclusion that did not arrive as a string is dropped from the list rather than
    // rendered as "[object Object]" beside four real ones. The list being shorter than the
    // API's is reported by the screen through the same "some of this could not be read"
    // route as an unreadable breakdown row.
    doesNotCount: Array.isArray(doesNotCount)
      ? doesNotCount.filter((line): line is string => typeof line === 'string' && line !== '')
      : [],
    notMoneyInTheBank,
  }
}

/**
 * What a confirmed payment was for, when there is no service to name.
 *
 * A DISPLAY CATALOGUE WITH AN OPEN FALLBACK, exactly like `PAYMENT_METHODS` above. The
 * backend's `payable_type` is a hand-rolled string and the contract types it `string`, so
 * an unrecognised value renders as itself rather than throwing or being dropped — a
 * category of takings that vanished from the breakdown is the failure this screen must not
 * have.
 *
 * @see backend/app/Models/PaymentIntent.php — PATIENT_OWNED_PAYABLES
 */
export const PAID_FOR = {
  appointment: 'Appointment',
  dispense_order: 'Medicines dispensed',
} as const satisfies Record<string, string>

export type PaidForValue = keyof typeof PAID_FOR

export function paidForLabel(paidFor: string): string {
  return paidFor in PAID_FOR ? PAID_FOR[paidFor as PaidForValue] : paidFor
}

/**
 * The heading a breakdown row is filed under.
 *
 * THE SERVICE NAME WINS WHERE THERE IS ONE, and where there is not, the row is filed under
 * what it was paid for rather than under an invented service. The backend argues this in
 * the resource: "a dispensing order has no bookable service, and inventing a heading for it
 * would file medicines under a service that doesn't exist." An "Other" bucket would do the
 * same damage more quietly, by putting a deleted service and a dispensing order in one row
 * that means neither.
 *
 * A service that has since been deleted arrives with an id and no name. It is named by what
 * it was paid for, and `serviceId` is still on the row so the screen can say the service
 * itself is gone rather than implying the takings were never for one.
 */
export function serviceHeading(row: ConfirmedByService): string {
  return row.serviceName ?? paidForLabel(row.paidFor)
}

/** A positive-or-zero integer count, or null. Never a float and never a negative. */
function countFrom(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Narrow one `by_method_recorded` row, or refuse it.
 *
 * `method_recorded` IS READ FROM THE FIELD OF THAT NAME AND FROM NO OTHER. The backend is
 * emphatic that `_recorded` is what we wrote down when the collection was opened and
 * `_confirmed` is what the aggregator told us, and that the two words are never swapped —
 * Pesapal returns a `payment_method` on GetTransactionStatus and nothing stores it. A
 * parser that fell back to a `method` key would quietly reintroduce the claim the field
 * name was built to refuse.
 */
export function confirmedByMethodFrom(value: unknown): ConfirmedByMethod | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const source = value as Record<string, unknown>
  const methodRecorded = source['method_recorded']
  const count = countFrom(source['aggregator_confirmed_count'])
  const total = moneyFrom(source['aggregator_confirmed_total'])

  if (typeof methodRecorded !== 'string' || methodRecorded === '' || count === null || total === null) {
    return null
  }

  return { methodRecorded, count, total }
}

/**
 * Narrow one `by_service` row, or refuse it.
 *
 * `service_id` AND `service_name` MAY BE NULL AND THAT IS NOT A FAILURE — it is the API
 * saying this row was not for a bookable service, or was for one that has since been
 * deleted. Only `paid_for`, the count and the amount are required, because those three are
 * what makes the row a fact about money; without any one of them there is nothing to
 * render that would not be a guess.
 */
export function confirmedByServiceFrom(value: unknown): ConfirmedByService | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const source = value as Record<string, unknown>
  const serviceId = source['service_id']
  const serviceName = source['service_name']
  const paidFor = source['paid_for']
  const count = countFrom(source['aggregator_confirmed_count'])
  const total = moneyFrom(source['aggregator_confirmed_total'])

  if (typeof paidFor !== 'string' || paidFor === '' || count === null || total === null) {
    return null
  }

  return {
    serviceId: typeof serviceId === 'string' && serviceId !== '' ? serviceId : null,
    serviceName: typeof serviceName === 'string' && serviceName !== '' ? serviceName : null,
    paidFor,
    count,
    total,
  }
}
