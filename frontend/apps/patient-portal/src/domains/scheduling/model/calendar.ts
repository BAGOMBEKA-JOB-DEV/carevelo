/**
 * Calendar arithmetic in the CLINIC'S day, not the server's and not the phone's.
 *
 * WHY THIS IS NOT `new Date()`. The portal renders in a data centre almost certainly
 * running UTC; the clinic opens at eight in Kampala. "Today" is a wall-clock fact about
 * the clinic, and three hours is enough to move it to a different date — so the bug does
 * not look like a timezone bug, it looks like the wrong day. Every boundary below is
 * therefore computed by asking `Intl` for the calendar date in the tenant's own zone,
 * exactly as `AvailabilityController` computes its window in the tenant's own zone.
 *
 * WHY A `YYYY-MM-DD` STRING RATHER THAN A DATE. It is what the API's `from` and `to`
 * accept, and `AvailabilityController::window()` parses it WITH the clinic's timezone —
 * so a plain date means the clinic's whole day, opening to closing, and nothing in this
 * file ever has to name an offset. The one place an offset would be needed is the one
 * place it is never written.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Uganda keeps EAT year-round, but the zone is still read from the tenant rather than
 * assumed, because the tenant is where it is configured and a second clinic in a second
 * country is a data change rather than a code change.
 *
 * A zone the runtime does not recognise falls back rather than throwing: a clinic that
 * saved a bad timezone should see slightly-off day boundaries, not a page that will not
 * render at all.
 */
export function clinicToday(timeZone: string): string {
  return formatDate(new Date(), timeZone)
}

/**
 * The calendar date of an instant, in the clinic's zone.
 *
 * `en-CA` because it formats as `YYYY-MM-DD`, which is both what the API accepts and
 * what sorts correctly as a string. Not a locale choice a reader ever sees.
 */
export function formatDate(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant)
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kampala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant)
  }
}

/**
 * Pure calendar arithmetic on a `YYYY-MM-DD`, done in UTC on purpose.
 *
 * No zone is involved because none is needed: adding a day to a date is a statement about
 * a calendar, not about a clock, and doing it through a zone is how an hour of daylight
 * saving somewhere else turns "tomorrow" into "today at 23:00".
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)

  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))

  return shifted.toISOString().slice(0, 10)
}

/** Whether a value from a query string is a date this module will act on. */
export function isCalendarDate(value: string | undefined): value is string {
  return value !== undefined && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))
}

/**
 * An INSTANT at midday on a calendar date, for labelling a day.
 *
 * `<DateTime>` and `formatInstant()` take an instant, and a day-picker needs to render
 * "21 Aug 2026" for a bare date. Midday UTC is the safe representative: it is the same
 * calendar day in every zone on earth, so the label can never name the day before or the
 * day after the one the value means.
 */
export function middayOn(date: string): string {
  return `${date}T12:00:00Z`
}

/**
 * How far ahead the booking screen looks by default.
 *
 * SEVEN DAYS, WHERE THE API WOULD GIVE FOURTEEN. The API's default is a fortnight and it
 * caps the response at five hundred slots; ten-minute slots across several clinicians hit
 * that easily, and every one of them would be a radio button rendered onto a mid-range
 * Android over mobile data. A week is what a patient is actually choosing within, and the
 * day filter reaches the rest.
 */
export const DEFAULT_WINDOW_DAYS = 6

export type Window = { from: string; to: string }

/**
 * The window to ask availability for: one named day, or the coming week.
 */
export function availabilityWindow(timeZone: string, day: string | undefined): Window {
  const today = clinicToday(timeZone)

  if (isCalendarDate(day) && day >= today) {
    return { from: day, to: day }
  }

  return { from: today, to: addDays(today, DEFAULT_WINDOW_DAYS) }
}

/** The days a patient may pick between: today and the rest of the window. */
export function windowDays(timeZone: string): string[] {
  const today = clinicToday(timeZone)

  return Array.from({ length: DEFAULT_WINDOW_DAYS + 1 }, (_, index) => addDays(today, index))
}
