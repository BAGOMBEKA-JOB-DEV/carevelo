import { describe, expect, it } from 'vitest'
import {
  DUE_SOON_DAYS,
  isOnTrial,
  knownPlan,
  paidThroughAt,
  standingOf,
} from './subscription'

/**
 * The only judgement on the billing screens, and therefore the only thing tested here.
 *
 * ------------------------------------------------------------------
 * WHAT THESE TESTS ARE GUARDING
 *
 * Everything else in the billing surface is the contract's shape rendered — the compiler
 * checks it, and a test would only re-state a type. `standingOf` is different: it reads two
 * nullable dates and returns a word that decides which clinics an operator rings this week.
 * Every way it can be wrong is silent. A clinic filed under `in_period` because a date
 * failed to parse is a clinic nobody chases; a clinic still inside its trial filed under
 * `no_commercial_record` is a whole population that disappears from the register.
 *
 * THE BOUNDARY BETWEEN THIS AND THE BACKEND IS ALSO UNDER TEST. Suspension is decided by an
 * hourly command against a grace period held in `config/billing.php` and published on no
 * endpoint. The last test in this file asserts that nothing here reproduces it — not
 * because the assertion is clever, but because "just add the grace window, it's only seven
 * days" is exactly the change somebody makes with good intentions, and the moment it lands
 * this screen starts predicting suspensions from a number that can change without it.
 *
 * @see backend/app/Models/Tenant.php — subscriptionHasLapsed()
 * @see backend/config/billing.php — grace_days, which is NOT on the wire
 */

/** A fixed instant to judge everything against: 15 August 2026, midday UTC. */
const NOW = Date.parse('2026-08-15T12:00:00Z')

const DAY_MS = 24 * 60 * 60 * 1000

/** An ISO instant a given number of days from NOW. Negative is in the past. */
const daysFromNow = (days: number) => new Date(NOW + days * DAY_MS).toISOString()

const clinic = (over: Partial<{
  plan: string | null
  current_period_ends_at: string | null
  trial_ends_at: string | null
}>) => ({
  plan: 'clinic' as string | null,
  current_period_ends_at: null as string | null,
  trial_ends_at: null as string | null,
  ...over,
})

describe('what a clinic is paid through', () => {
  it('is the paid period when there is one', () => {
    const paidThrough = paidThroughAt({
      current_period_ends_at: daysFromNow(20),
      trial_ends_at: daysFromNow(-40),
    })

    expect(paidThrough).toBe(NOW + 20 * DAY_MS)
  })

  /*
   * THE BACKEND'S OWN FALLBACK, MIRRORED IN ONE LINE. `Tenant::subscriptionHasLapsed()`
   * reads `current_period_ends_at ?? trial_ends_at`, because a trial IS what a clinic is
   * paid through until a collection has ever succeeded. A register that read only the paid
   * period would show every clinic still on trial as having no commercial record — and
   * clinics on trial are the population this screen most needs to surface before they lapse.
   */
  it('falls back to the trial when no period has ever been collected', () => {
    expect(paidThroughAt({ current_period_ends_at: null, trial_ends_at: daysFromNow(5) }))
      .toBe(NOW + 5 * DAY_MS)
  })

  it('is nothing at all when neither date is set', () => {
    expect(paidThroughAt({ current_period_ends_at: null, trial_ends_at: null })).toBeNull()
  })

  /*
   * `new Date('nonsense')` is an Invalid Date whose comparisons are ALL false, so a naive
   * `paidThrough < now` would be false and the clinic would be filed under `in_period` —
   * the one answer that means nobody needs to do anything. A date this app cannot read must
   * never resolve to "everything is fine".
   */
  it('is nothing at all when the date cannot be read, rather than a date in the future', () => {
    expect(paidThroughAt({ current_period_ends_at: 'not a date', trial_ends_at: null })).toBeNull()
  })
})

describe('a trial is not a paid period', () => {
  it('is a trial when only the trial date is set', () => {
    expect(isOnTrial({ current_period_ends_at: null, trial_ends_at: daysFromNow(9) })).toBe(true)
  })

  /*
   * Once a collection has succeeded the clinic is a paying customer, even if the old trial
   * date is still on the row. Reading it as a trial after that would record a paying clinic
   * as one that has never paid a shilling.
   */
  it('is not a trial once a period has been paid for, however stale the trial date', () => {
    expect(isOnTrial({ current_period_ends_at: daysFromNow(20), trial_ends_at: daysFromNow(-40) }))
      .toBe(false)
  })

  it('is not a trial when there is no trial date', () => {
    expect(isOnTrial({ current_period_ends_at: null, trial_ends_at: null })).toBe(false)
  })
})

describe('how a clinic’s dates read today', () => {
  it('is in period when the paid period is comfortably ahead', () => {
    expect(standingOf(clinic({ current_period_ends_at: daysFromNow(45) }), NOW)).toBe('in_period')
  })

  it('is due soon inside the reading horizon', () => {
    expect(standingOf(clinic({ current_period_ends_at: daysFromNow(3) }), NOW)).toBe('due_soon')
  })

  it('is past due once the paid period has ended', () => {
    expect(standingOf(clinic({ current_period_ends_at: daysFromNow(-1) }), NOW)).toBe('past_due')
  })

  /*
   * A clinic inside its trial is `due_soon` or `in_period` on the same dates as a paying
   * one, because the register's question is "when does this stop being paid for?" and the
   * answer is the same. Which of the two it is gets said by `isOnTrial`, separately, so the
   * screen can write "trial ends" where it would otherwise write "paid through".
   */
  it('reads a trial on exactly the same dates as a paid period', () => {
    expect(standingOf(clinic({ trial_ends_at: daysFromNow(2) }), NOW)).toBe('due_soon')
    expect(standingOf(clinic({ trial_ends_at: daysFromNow(-2) }), NOW)).toBe('past_due')
  })

  /*
   * THE DEPLOY-DAY RULE, WHICH THE BACKEND LEARNED FIRST. Every clinic in the register had a
   * null `current_period_ends_at` the day the column shipped, and reading "no paid period"
   * as "lapsed" would have suspended every clinic in the country on the first run of an
   * hourly job. `subscriptionHasLapsed()` refuses to, and neither does this: no dates is its
   * own standing and never `past_due`.
   */
  it('never reads a clinic with no dates at all as past due', () => {
    expect(standingOf(clinic({ plan: null }), NOW)).toBe('no_commercial_record')
    expect(standingOf(clinic({ plan: 'starter' }), NOW)).toBe('never_collected')
  })

  /*
   * TWO DIFFERENT JOBS FOR AN OPERATOR, AND THEY MUST NOT COLLAPSE. A plan on file with
   * nothing ever collected is a collection to start — it costs money every month it
   * persists. No plan at all is a conversation to have. Merging them hides the first inside
   * the second, and the first is the expensive one.
   */
  it('separates a clinic nobody billed from a clinic nobody talked to', () => {
    expect(standingOf(clinic({ plan: 'group' }), NOW)).not.toBe(
      standingOf(clinic({ plan: null }), NOW),
    )
  })

  it('treats a date it cannot read as no date at all, never as a period still running', () => {
    // An unreadable date is deliberately indistinguishable from an absent one: both mean
    // this screen does not know when the clinic is paid through, and neither may be
    // reported as a period that is still running.
    expect(standingOf(clinic({ plan: 'clinic', current_period_ends_at: 'not a date' }), NOW))
      .toBe('never_collected')
  })

  /*
   * ONE INSTANT FOR THE WHOLE PAGE. `now` is a parameter rather than a `Date.now()` read
   * inside, so every clinic in a render is judged against the same moment — a list where
   * row forty was classified milliseconds after row one can, at a boundary, put two clinics
   * with identical dates in different columns.
   */
  it('classifies against the instant it is given and never against the wall clock', () => {
    const ends = daysFromNow(30)

    expect(standingOf(clinic({ current_period_ends_at: ends }), NOW)).toBe('in_period')
    expect(standingOf(clinic({ current_period_ends_at: ends }), NOW + 25 * DAY_MS)).toBe('due_soon')
    expect(standingOf(clinic({ current_period_ends_at: ends }), NOW + 31 * DAY_MS)).toBe('past_due')
  })

  it('takes the horizon as an argument, so the screen and this file cannot disagree', () => {
    const ends = daysFromNow(20)

    expect(standingOf(clinic({ current_period_ends_at: ends }), NOW, 14)).toBe('in_period')
    expect(standingOf(clinic({ current_period_ends_at: ends }), NOW, 30)).toBe('due_soon')
  })

  /*
   * THE BOUNDARY THIS SCREEN MUST NOT CROSS.
   *
   * Suspension is `billing:suspend-lapsed`, an hourly command reading a grace period from
   * `config/billing.php` that no endpoint publishes. If the horizon here were ever set to
   * that grace period, this register would start predicting suspensions from a number
   * copied out of a backend config file — and would go on asserting it with total
   * confidence after somebody changed the config.
   *
   * The horizon is deliberately WIDER than the seven-day grace window, and that gap is the
   * useful part: a clinic surfaces here while there is still time to pay before the period
   * ends at all, let alone before the grace window closes.
   */
  it('looks further ahead than the backend’s grace window, and never equals it', () => {
    const GRACE_DAYS_IN_CONFIG_BILLING_PHP = 7

    expect(DUE_SOON_DAYS).toBeGreaterThan(GRACE_DAYS_IN_CONFIG_BILLING_PHP)
  })
})

describe('a plan this build has never heard of', () => {
  it('narrows the three published tiers', () => {
    expect(knownPlan('starter')).toBe('starter')
    expect(knownPlan('clinic')).toBe('clinic')
    expect(knownPlan('group')).toBe('group')
  })

  it('is null rather than mislabelled as one of the three', () => {
    expect(knownPlan('enterprise')).toBeNull()
    expect(knownPlan(null)).toBeNull()
  })
})
