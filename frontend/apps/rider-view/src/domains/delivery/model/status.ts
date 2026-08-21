import type { DeliveryStatus } from './types'

/**
 * The delivery state machine, as far as a RIDER is concerned.
 *
 * ------------------------------------------------------------
 * WHY THIS TABLE EXISTS RATHER THAN A HANDFUL OF `if`s IN THE SCREENS
 *
 * The transitions are enforced on the server — `DeliveryStatus::allowedTransitions()`,
 * asserted inside `Delivery::transitionTo()` — and nothing here can loosen them. What
 * this file decides is which of the legal moves a rider is OFFERED, and getting that
 * wrong is expensive in both directions:
 *
 *  - Offer a move the machine will refuse, and the rider presses a button at the roadside
 *    and gets a 409 they can do nothing about. Their next act is a telephone call to the
 *    clinic, which is the cost this product exists to remove.
 *  - Withhold a move the machine allows, and the delivery sits in a state nobody can
 *    advance, on a screen with no explanation.
 *
 * Written as one `Record<DeliveryStatus, …>` on purpose: TypeScript requires every key,
 * so the day the contract grows an eighth status this file stops compiling instead of
 * silently rendering a blank label. That is the same reason it is keyed by the generated
 * union rather than by a string.
 *
 * ------------------------------------------------------------
 * WHAT A RIDER IS OFFERED, AND WHAT THEY ARE NOT
 *
 * The forward path is three steps: `assigned → picked_up → en_route → delivered`, plus
 * `en_route → failed` with a reason. Note where failure lives — the machine allows it
 * ONLY from `en_route`, so a package still on the pharmacy counter cannot be marked
 * failed. That is not an oversight to work around; a delivery that never left has not
 * failed, it has not started.
 *
 * `assigned → unassigned` IS LEGAL AND IS DELIBERATELY NOT OFFERED. It is how a delivery
 * is handed back to the board, and a rider handing work back is a dispatch decision, made
 * by the person who can see every rider and reassign it — which is precisely the board
 * this app must never show. A rider who cannot take a job telephones the dispatcher, and
 * that call is the coordination, not a workaround for a missing button.
 *
 * `failed → returned_to_pharmacy` IS ALSO NOT OFFERED HERE. Medicine goes back to
 * licensed premises and never sits with a rider overnight, so that transition is recorded
 * by whoever receives it at the pharmacy counter. A rider marking the stock "returned"
 * from the road would be a record of a handover that had not happened yet.
 *
 * @see backend/app/Models/DeliveryStatus.php
 * @see backend/app/Models/Delivery.php — `FAILURE_REASONS`, and `fail()`
 */

/** One status, as it is described to the rider. */
export type StatusView = {
  /** What the rider is told this delivery currently is. */
  readonly label: string
  /**
   * Where this delivery sits on the rider's own linear path, or `null` for a state off
   * it. Used for exactly one thing — see `hasReached()` — and never for ordering a list.
   */
  readonly rank: number | null
  /** The one move this screen offers from here, if any. */
  readonly advance: Advance | null
  /** Whether "could not deliver" is offered. True only where the machine allows it. */
  readonly mayFail: boolean
}

/** A move the rider is offered, with the words that go on the button. */
export type Advance = {
  readonly target: DeliveryStatus
  /** The button. An action in the rider's own voice, because they are the one doing it. */
  readonly action: string
  /** What pressing it records, in one line, before they press it. */
  readonly consequence: string
}

const STATUS: Record<DeliveryStatus, StatusView> = {
  /*
   * Off the rider's list entirely: no rider_id, so `RiderDeliveryController::index()`
   * never returns it. Described anyway, because a rider CAN still open a delivery by its
   * own URL — a page left open when the dispatcher took the job back — and a screen that
   * renders a blank status in that moment is a screen that has lost the rider's trust.
   */
  unassigned: {
    label: 'Not assigned',
    rank: null,
    advance: null,
    mayFail: false,
  },

  assigned: {
    label: 'To collect',
    rank: 1,
    advance: {
      target: 'picked_up',
      action: 'I have collected it',
      consequence: 'Records that the package is with you.',
    },
    mayFail: false,
  },

  picked_up: {
    label: 'Collected',
    rank: 2,
    advance: {
      target: 'en_route',
      action: 'I am on the way',
      consequence: 'Tells the clinic you have set off, so they can tell the recipient.',
    },
    mayFail: false,
  },

  en_route: {
    label: 'On the way',
    rank: 3,
    advance: {
      target: 'delivered',
      action: 'Delivered',
      consequence: 'Records the handover. This is the last step and cannot be undone here.',
    },
    // The one state the machine allows `failed` from.
    mayFail: true,
  },

  delivered: {
    label: 'Delivered',
    rank: 4,
    advance: null,
    mayFail: false,
  },

  /*
   * Terminal FOR THE RIDER. The machine allows `failed → returned_to_pharmacy`, but that
   * is recorded at the pharmacy counter by whoever takes the package back — see the note
   * at the top of this file.
   */
  failed: {
    label: 'Could not be delivered',
    rank: null,
    advance: null,
    mayFail: false,
  },

  returned_to_pharmacy: {
    label: 'Returned to the pharmacy',
    rank: null,
    advance: null,
    mayFail: false,
  },
}

/**
 * How this status is described and what may be done from it.
 *
 * `status` arrives as a bare `string`, because that is how `RiderDeliveryResource` types
 * it in the contract even though the values are the `DeliveryStatus` union. Narrowing
 * happens here, once, against the table itself — so an unrecognised value gets an honest
 * label instead of an empty badge, and gets NO controls, which is the safe direction: the
 * screen would rather offer nothing than offer a move it cannot reason about.
 */
export function view(status: string): StatusView {
  return (
    STATUS[status as DeliveryStatus] ?? {
      label: 'Status unknown',
      rank: null,
      advance: null,
      mayFail: false,
    }
  )
}

/**
 * Whether the API (or a query string) has handed us a status this table knows about.
 *
 * A SCREEN THAT ECHOES A STATUS BACK MUST CHECK THIS FIRST. `?done=` travels in a URL and
 * a URL is typed, shared and truncated, so a confirmation banner reading "Recorded: status
 * unknown" is one hand-edited address bar away. `view()` is deliberately total and returns
 * a safe fallback for anything it does not recognise; this is how a caller asks whether the
 * fallback is what it is about to render.
 */
export function isKnownStatus(status: string): status is DeliveryStatus {
  return Object.hasOwn(STATUS, status)
}

/**
 * Has this delivery already reached the status a request was trying to set?
 *
 * ------------------------------------------------------------
 * THIS IS THE FUNCTION THAT MAKES A STATUS CHANGE SURVIVE A BAD CONNECTION.
 *
 * The status endpoint stores no idempotency key — `ApiClient` will send one and nothing
 * reads it — so a repeated POST is a genuinely repeated attempt, and the state machine
 * answers the second one with a 409: `Cannot transition Delivery from picked_up to
 * picked_up.` That is exactly right on the server and exactly wrong on the rider's
 * screen, because the two situations it cannot tell apart are:
 *
 *  - the first request landed and the response was lost on the way back (a tunnel, a cell
 *    handover, a browser killed by Android to reclaim memory), and the rider pressed the
 *    button again; and
 *  - somebody else moved the delivery while the rider was riding.
 *
 * In the first case the rider's work is DONE and an error would send them back to press a
 * button that will never succeed. So a 409 is not reported until the delivery has been
 * re-read: if it has already reached the target, the tap worked and the screen says so.
 * Only if it landed somewhere else is there really a conflict to report.
 *
 * The comparison is a rank on the rider's own linear path, not equality, so a retry that
 * arrives after the rider has already moved on — offline, then two taps once the signal
 * returns — is still recognised as landed. Statuses off that path (`failed`,
 * `returned_to_pharmacy`, `unassigned`) rank `null` and never compare as "reached": a
 * failed delivery has emphatically not been delivered, and reporting it as such would be
 * the worst lie this screen could tell.
 */
export function hasReached(current: string, target: DeliveryStatus): boolean {
  const here = view(current).rank
  const there = view(target).rank

  if (here === null || there === null) {
    return false
  }

  return here >= there
}

/**
 * Why a delivery could not be completed.
 *
 * A FIXED LIST, AND IT IS NOT A UI CONVENTION. `Delivery::fail()` checks the value
 * against `Delivery::FAILURE_REASONS` and throws otherwise, so anything not on this list
 * is refused by the API. The reason it is a list rather than free text is written into
 * the backend const: "Free text alone cannot be reported on." A clinic that cannot count
 * how often addresses are wrong cannot fix its addresses.
 *
 * IT IS ALSO A MINIMISATION BOUNDARY. Free text typed by a rider at somebody's gate is
 * exactly where a medicine name or a remark about the recipient's health would end up,
 * and `failure_reason` is carried on the `DeliveryFailed` broadcast frame. Four codes
 * cannot carry any of that.
 *
 * WRITTEN OUT HERE BECAUSE THE CONTRACT DOES NOT PUBLISH IT. `StatusBody.failure_reason`
 * is typed `string`, so there is no generated union to derive from — this is the one
 * value in the domain that is not taken from `schema.d.ts`, and the API re-validates it
 * regardless, which is what keeps the copy honest.
 *
 * @see backend/app/Models/Delivery.php — `FAILURE_REASONS`
 */
export const FAILURE_REASONS = [
  {
    value: 'recipient_unreachable',
    label: 'Nobody answered',
    note: 'You reached the address and could not reach the recipient.',
  },
  {
    value: 'address_incorrect',
    label: 'The address is wrong',
    note: 'The address does not exist or is not where the recipient is.',
  },
  {
    value: 'refused',
    label: 'They would not take it',
    note: 'The recipient was there and declined the package.',
  },
  {
    value: 'rider_unable_to_complete',
    label: 'I could not complete it',
    note: 'A breakdown, an accident, or anything else that stopped you.',
  },
] as const

export type FailureReason = (typeof FAILURE_REASONS)[number]['value']

/** Whether a submitted reason is one the API will accept, checked before it is sent. */
export function isFailureReason(value: string): value is FailureReason {
  return FAILURE_REASONS.some((reason) => reason.value === value)
}

/** The rider-facing words for a reason, for a screen that has to show one back. */
export function failureLabel(value: string): string {
  return FAILURE_REASONS.find((reason) => reason.value === value)?.label ?? 'Not recorded'
}
