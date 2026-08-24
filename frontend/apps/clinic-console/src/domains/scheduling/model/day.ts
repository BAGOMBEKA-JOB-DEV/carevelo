/**
 * Which day the clinic is looking at, in the clinic's own time zone.
 *
 * ------------------------------------------------------------------------------------
 * WHY THIS FILE EXISTS RATHER THAN `new Date().toISOString().slice(0, 10)`
 *
 * That one-liner asks the SERVER what day it is, in UTC. Uganda is UTC+03:00 with no
 * daylight saving, so between midnight and 03:00 Kampala time it answers "yesterday" — and
 * a clinician opening the console at 06:30 for a 07:00 list would be shown the wrong day's
 * appointments with nothing on screen to suggest anything was wrong. It is also wrong in
 * the other direction on a server running in any other zone, which is every deployment
 * that is not deliberately pinned to UTC.
 *
 * So every day boundary here is computed against `Africa/Kampala` explicitly, through
 * `Intl`, which is the only mechanism in the platform that knows what a zone is. The same
 * constant is used by `@carevelo/ui`'s DateTime, which is what renders every instant on
 * these screens; a second answer to "what day is it" would put the heading and the rows
 * into different days.
 *
 * THE API AGREES WITH THIS. `IndexAppointmentRequest::from()` parses a plain `YYYY-MM-DD`
 * and takes `startOfDay()`, `to()` takes `endOfDay()`, both in the application's configured
 * zone. So a day view asks for `from=<day>&to=<day>` and gets exactly that day — there is
 * no need to send instants, and sending them would be a second interpretation of the
 * boundary that could disagree with the clinic's.
 */

/** The clinic's time zone. Uganda has one, and it does not observe daylight saving. */
export const CLINIC_ZONE = 'Africa/Kampala'

/**
 * `en-CA` because it formats as `YYYY-MM-DD`, which is the shape the API's `date` rule
 * accepts and the shape that sorts as a string. Not a display locale — nothing a person
 * reads is formatted here; that is `DateTime`'s job.
 */
const ISO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** How a day is written on this screen and in the query string: `2026-08-21`. */
export type IsoDay = string

/** Today, at the clinic. */
export function today(now: Date = new Date()): IsoDay {
  return ISO_DAY.format(now)
}

/**
 * A day the caller supplied, or today.
 *
 * VALIDATED, NOT TRUSTED. `?day=` is in the URL and is therefore written by whoever sent
 * the link. An unparseable value falls back to today rather than being passed to the API,
 * because a 422 on a day view reads as "the schedule is broken" and the honest answer to
 * "show me the schedule for banana" is today's schedule.
 */
export function dayOrToday(value: string | null | undefined, now: Date = new Date()): IsoDay {
  return isIsoDay(value) ? value : today(now)
}

/** Exactly ten characters, `YYYY-MM-DD`, naming a day that exists. */
export function isIsoDay(value: string | null | undefined): value is IsoDay {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  // `Date.parse` on a bare date string is UTC midnight, which is fine here: this only asks
  // whether the calendar day exists, and 2026-02-30 does not in any zone. Re-formatting
  // and comparing catches the roll-over that `Date` performs silently.
  const parsed = new Date(`${value}T00:00:00Z`)

  if (Number.isNaN(parsed.getTime())) {
    return false
  }

  return parsed.toISOString().slice(0, 10) === value
}

/**
 * The day `offset` days from this one.
 *
 * Arithmetic on the UTC instant of that day's midnight, then re-formatted. Safe because
 * Uganda has no daylight saving: every day is exactly 24 hours, so no "add a day" here can
 * land on the same date twice or skip one. That assumption is written down because it is
 * the assumption that makes this three lines instead of thirty, and it stops being true the
 * moment this product is deployed somewhere that does observe it.
 */
export function shiftDay(day: IsoDay, offset: number): IsoDay {
  const base = new Date(`${day}T12:00:00Z`)

  base.setUTCDate(base.getUTCDate() + offset)

  return base.toISOString().slice(0, 10)
}

/**
 * A day, written the way a clinician reads it: `Fri 21 Aug 2026`.
 *
 * Not `DateTime` from @carevelo/ui, and the difference is deliberate: that component
 * formats an INSTANT, and a day on a schedule is not an instant. Handing it
 * `2026-08-21T00:00:00Z` would render `21 Aug` in Kampala and `20 Aug` for anyone reading
 * the same page from a UTC-4 hotel room, which is exactly the class of bug this file
 * exists to prevent.
 */
export function readableDay(day: IsoDay): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return formatter.format(new Date(`${day}T12:00:00Z`))
}

/** Is this the clinic's today? Used to label the day view, never to gate anything. */
export function isToday(day: IsoDay, now: Date = new Date()): boolean {
  return day === today(now)
}

/**
 * The hour and minute of an instant, at the clinic. `14:30`.
 *
 * Duplicates what `DateTime format="time"` renders, and is here because a day view needs
 * the value as a STRING — to group rows by hour, to build an `aria-label`, to put in a
 * confirmation sentence. `@carevelo/ui` exports `formatInstant` for exactly this, so this
 * function delegates rather than defining a second set of options that could drift.
 */
export function clinicTime(instant: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(instant))
}
