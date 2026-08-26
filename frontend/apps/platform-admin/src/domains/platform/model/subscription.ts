import type { BadgeTone } from '@carevelo/ui'
import type { components, operations } from '@carevelo/api-client'

/**
 * A clinic's commercial relationship with Carevelo, and the one thing this screen decides.
 *
 * ==================================================================
 * EVERY TYPE HERE IS THE CONTRACT'S. THE ONE FUNCTION IS NOT, AND THAT IS THE POINT.
 * ==================================================================
 *
 * `PlatformSubscriptionResource` carries `@mixin Tenant`, so unlike most of the money
 * shapes in this product it generated cleanly: plan, price as `{amount_minor, currency}`,
 * both dates, the status and the recent charges are all fully described. Nothing below
 * re-describes any of them.
 *
 * What the contract does NOT carry is a verdict. It sends two dates and leaves the reading
 * of them to the client, which is correct — but it means this file holds the only piece of
 * judgement on the billing screens, so it is the only piece that is unit-tested.
 *
 * ==================================================================
 * WHAT `standingOf` IS, AND THE LARGER THING IT DELIBERATELY IS NOT
 * ==================================================================
 *
 * IT IS A READING OF TWO DATES. Nothing more. It says whether a clinic's paid-through date
 * is ahead, near or behind, so an operator can see at a glance who to ring this week.
 *
 * IT IS NOT A PREDICTION OF SUSPENSION, and it must never become one. Suspension is decided
 * by `billing:suspend-lapsed`, an hourly command that reads `Tenant::subscriptionHasLapsed()`
 * against a grace period held in `config/billing.php`. THAT GRACE PERIOD IS NOT ON THE WIRE
 * — no endpoint publishes it — so a screen that said "this clinic will be suspended on
 * Tuesday" would be doing it from a number copied out of a backend config file into a
 * browser, where it would go on being asserted with total confidence after somebody changed
 * the config. This screen therefore says what IS true — the period ended on this date — and
 * lets the clinic's own `status` say what was DONE about it. Suspension already exists as a
 * lifecycle control; this reads it rather than reinventing it.
 *
 * THE ONE BACKEND RULE THAT IS MIRRORED, AND WHY IT HAD TO BE. "Paid through" is
 * `current_period_ends_at ?? trial_ends_at` — the trial is what a clinic is paid through
 * until a collection has ever succeeded. That single line is copied from
 * `Tenant::subscriptionHasLapsed()` because the resource ships both dates and no derived
 * field: a screen that read only `current_period_ends_at` would show every clinic still on
 * trial as having no commercial record at all, which is the population this register exists
 * to chase. The grace window is not copied. One line of a rule is a citation; the whole rule
 * is a second implementation.
 *
 * @see backend/app/Models/Tenant.php — subscriptionHasLapsed()
 * @see backend/app/Console/Commands/SuspendLapsedSubscriptionsCommand.php
 * @see backend/app/Http/Resources/Platform/PlatformSubscriptionResource.php
 */

/** A clinic's plan, price, dates and recent charges. Straight off the contract. */
export type Subscription = components['schemas']['PlatformSubscriptionResource']

/** One attempt to collect a clinic's monthly fee. Described inline by the resource. */
export type SubscriptionCharge = Subscription['recent_charges'][number]

/**
 * The published tiers: `starter` | `clinic` | `group`.
 *
 * NOTE WHAT THE ENUM DOES NOT CARRY: the price. The backend is emphatic about it — a tier
 * says what a clinic GETS and the tenant says what it PAYS, and the two are permitted to
 * disagree, because a clinic that negotiated a price keeps it and a price list here would
 * silently re-price every clinic on a tier the day it changed. So there is no price table
 * in this app either, and the form that records a plan asks for the amount every time.
 */
export type Plan = components['schemas']['SubscriptionPlan']

/** `{ plan, price }` — both required together, exactly as `PUT .../subscription` accepts it. */
export type PlanBody = components['schemas']['UpdateSubscriptionRequest']

type CollectResponse =
  operations['v1.platform.subscription.collect']['responses'][201]['content']['application/json']

/**
 * Where the clinic's administrator goes to authorise the recurring collection.
 *
 * Carevelo is the merchant for this one call and for nothing else in the product. The
 * redirect is Pesapal's hosted page against CAREVELO'S OWN account; a clinic's own
 * aggregator account is not reachable from that endpoint in any way.
 */
export type CollectionHandoff = CollectResponse['data']

/** Every tier, in the order a price list would print them. */
export const PLANS: readonly Plan[] = ['starter', 'clinic', 'group']

/**
 * What each tier is, in the sentence an operator needs before recording one.
 *
 * Taken from `SubscriptionPlan`'s own case comments rather than invented here, because the
 * enum is where the commercial definitions live and a second description of a tier is a
 * second description free to be more generous than the first.
 */
export const PLAN_MEANING: Record<Plan, string> = {
  starter: 'A single-clinician practice.',
  clinic: 'The ordinary case: one clinic, several clinicians, a dispensary.',
  group: 'Several sites under one owner, each still its own tenant.',
}

const KNOWN_PLANS = new Set<string>(PLANS)

/**
 * Narrow the resource's `plan`, which the contract types as a nullable plain string.
 *
 * A tier this build has never heard of is returned as null so callers render the raw value
 * rather than mislabel it as one of the three. An operator reading an unfamiliar tier name
 * learns something true; an operator reading `clinic` where the API said `enterprise` has
 * been told something false about what a clinic is paying for.
 */
export function knownPlan(plan: string | null): Plan | null {
  return plan !== null && KNOWN_PLANS.has(plan) ? (plan as Plan) : null
}

/**
 * What became of one attempt to collect, and how each reads.
 *
 * `initiated` IS AMBER AND NOT NEUTRAL. It means recorded and not yet answered for, which
 * the backend says is momentary — so one that is still amber days later is the row an
 * operator should be looking at, and a neutral pill would hide it among the settled ones.
 *
 * `reversed` IS AMBER AND NOT RED for the same reason `suspended` is on the lifecycle
 * badge: it is a fact to act on rather than a fault in the system, and it is always handled
 * by a person. Red here would put a failure colour on a screen where red already means a
 * charge that did not go through.
 */
export const CHARGE_TONE: Record<string, BadgeTone> = {
  initiated: 'warn',
  succeeded: 'good',
  failed: 'bad',
  reversed: 'warn',
}

export function chargeTone(status: string): BadgeTone {
  return CHARGE_TONE[status] ?? 'neutral'
}

/**
 * How a clinic's paid-through date reads today.
 *
 * A CLOSED SET, because each one needs a different sentence and a different colour, and
 * because a screen that branched on raw dates in six places would eventually disagree with
 * itself in one of them.
 */
export type Standing =
  /** No plan agreed, and no date of any kind. A clinic nobody has had the conversation with. */
  | 'no_commercial_record'
  /** A plan and a price are recorded, and nothing has ever been collected or granted. */
  | 'never_collected'
  /** Paid through a date comfortably ahead. Nothing to do. */
  | 'in_period'
  /** Paid through a date inside the reading horizon below. The list to work through this week. */
  | 'due_soon'
  /** The paid-through date has passed. What the platform does about it is `status`, not this. */
  | 'past_due'

/**
 * How near is "due soon".
 *
 * THIS IS A READING HORIZON AND NOT A RULE THE API ENFORCES, and the distinction is the
 * whole reason this constant is named, exported and stated on screen rather than inlined.
 * Nothing in the backend knows about fourteen days: it is how far ahead this register looks
 * so that an operator has a week's notice and a week to act, and the screen says "ends
 * within 14 days" in those words rather than implying a deadline somebody else is keeping.
 *
 * It is deliberately WIDER than `config/billing.php`'s seven-day grace period, and the
 * relationship between the two is the useful part: a clinic that appears here has time to
 * pay before the period ends at all, let alone before the grace window closes. A horizon
 * narrower than the grace period would surface clinics only once they were already past the
 * point where a phone call helps.
 */
export const DUE_SOON_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The instant a clinic is paid through, or null when it is not paid through anything.
 *
 * `current_period_ends_at ?? trial_ends_at`, WHICH IS THE BACKEND'S OWN LINE. A trial is
 * what a clinic is paid through until a collection has ever succeeded, and reading only the
 * period would show every clinic still inside its trial as having no commercial record —
 * which is precisely the population this register exists to chase before it lapses.
 *
 * An unparseable date is null rather than an epoch. `new Date('nonsense')` is an Invalid
 * Date that compares false against everything, so a naive comparison would silently file
 * the clinic under "in period" — the one answer that means nobody needs to do anything.
 *
 * @see backend/app/Models/Tenant.php — subscriptionHasLapsed()
 */
export function paidThroughAt(subscription: {
  current_period_ends_at: string | null
  trial_ends_at: string | null
}): number | null {
  const raw = subscription.current_period_ends_at ?? subscription.trial_ends_at

  if (raw === null) {
    return null
  }

  const parsed = Date.parse(raw)

  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Whether the clinic is inside a TRIAL rather than a paid period.
 *
 * Kept separate from the standing so the screen can say "trial ends" where it would
 * otherwise say "paid through". Calling a trial a paid period on a commercial register is
 * how a clinic that has never paid a shilling gets recorded as a paying customer.
 */
export function isOnTrial(subscription: {
  current_period_ends_at: string | null
  trial_ends_at: string | null
}): boolean {
  return subscription.current_period_ends_at === null && subscription.trial_ends_at !== null
}

/**
 * How this clinic's dates read, as of a given instant.
 *
 * `now` IS A PARAMETER AND NEVER `Date.now()` READ INSIDE. Two reasons and both matter: it
 * makes the function testable without freezing a clock, and it means one render of the
 * register classifies every clinic against the SAME instant — a list where row forty was
 * judged a few milliseconds after row one can, at a boundary, put two clinics with the same
 * date in different columns.
 *
 * A PLAN WITH NO DATES IS `never_collected` AND NOT `no_commercial_record`. The difference
 * is what the operator does next: one is a clinic somebody agreed terms with and never
 * billed, which is a collection to start; the other is a clinic nobody has had the
 * conversation with, which is a conversation to have. Collapsing them would hide the first
 * inside the second, and the first is the one that costs money every month it persists.
 *
 * THE DEPLOY-DAY RULE IS HONOURED HERE TOO. Every clinic in the register had a null
 * `current_period_ends_at` the day the column shipped, and the backend refuses to read "no
 * paid period" as "lapsed" for exactly that reason. Neither does this: no dates is its own
 * standing, never `past_due`.
 */
export function standingOf(
  subscription: {
    plan: string | null
    current_period_ends_at: string | null
    trial_ends_at: string | null
  },
  now: number,
  dueSoonDays: number = DUE_SOON_DAYS,
): Standing {
  const paidThrough = paidThroughAt(subscription)

  if (paidThrough === null) {
    return subscription.plan === null ? 'no_commercial_record' : 'never_collected'
  }

  if (paidThrough < now) {
    return 'past_due'
  }

  return paidThrough <= now + dueSoonDays * DAY_MS ? 'due_soon' : 'in_period'
}

/**
 * The badge tone for a standing.
 *
 * `past_due` IS AMBER AND NOT RED, deliberately and for the same reason `suspended` is on
 * the lifecycle badge. A clinic whose period has ended is a commercial fact, not a fault —
 * it may be four days into a seven-day grace window, its retry may be in flight at Pesapal,
 * and its staff are still signing in. Red is this system's colour for a failed or forbidden
 * state, and painting an ordinary billing cycle with it teaches operators to treat a late
 * payment as an incident, which is the confusion the whole suspension design exists to
 * prevent.
 */
export const STANDING_TONE: Record<Standing, BadgeTone> = {
  no_commercial_record: 'neutral',
  never_collected: 'info',
  in_period: 'good',
  due_soon: 'info',
  past_due: 'warn',
}

/** The word on the badge. Short enough for a table cell, and never a number. */
export const STANDING_LABEL: Record<Standing, string> = {
  no_commercial_record: 'no plan agreed',
  never_collected: 'never collected',
  in_period: 'in period',
  due_soon: 'due soon',
  past_due: 'past due',
}

/**
 * What each standing MEANS, and what the operator does about it.
 *
 * NOT ONE OF THESE SENTENCES PREDICTS A SUSPENSION. The grace period lives in
 * `config/billing.php`, is not published on any endpoint, and is applied hourly by a command
 * this app cannot see. Saying "suspended in three days" here would be asserting a number
 * copied out of a backend config file, with total confidence, for as long as it took anybody
 * to notice it had changed.
 */
export const STANDING_MEANING: Record<Standing, string> = {
  no_commercial_record:
    'No plan and no price recorded, and no trial or paid period either. Nothing will be '
    + 'collected from this clinic and nothing will suspend it. Record what was agreed, if '
    + 'anything was.',
  never_collected:
    'A plan and a price are on file and nothing has ever been collected or granted. Start '
    + 'the recurring collection, or set a trial if the clinic is not paying yet.',
  in_period: 'Paid through a date comfortably ahead. Nothing to do.',
  due_soon:
    'The paid period ends shortly. Pesapal collects on its own recurring schedule, so this '
    + 'is a clinic to watch rather than one to chase — unless no collection was ever '
    + 'authorised.',
  past_due:
    'The paid period has ended. A retry may still land: mobile-money collections here fail '
    + 'for reasons unconnected to willingness to pay. Whether staff sign-in has actually '
    + 'been blocked is the clinic’s lifecycle state, shown beside this, and never something '
    + 'this column predicts.',
}
