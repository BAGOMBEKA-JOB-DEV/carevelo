import type { WeekChanges, WorkingHour } from './types'

/**
 * The clinic's week: seven days, in the order an administrator thinks about them.
 *
 * `day_of_week` IS 0 = SUNDAY AND THAT IS NOT NEGOTIABLE — it is Carbon's numbering, it is
 * what the `(tenant_id, day_of_week)` unique index is keyed on, and it is what
 * /availability reads. What IS a presentation choice is the order the seven rows appear
 * in, and Monday-first is the order a clinic administrator setting opening hours is
 * actually thinking in. So the numbers below are the contract's and the sequence is ours;
 * the two are kept apart deliberately so nobody is ever tempted to "fix" the numbering to
 * match the display.
 */

export type DayOfWeek = { readonly value: number; readonly label: string; readonly short: string }

/** Monday first for the eye; 0 = Sunday for the wire. */
export const WEEK: readonly DayOfWeek[] = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 0, label: 'Sunday', short: 'Sun' },
]

/**
 * The clinic's stored week, indexed by day number.
 *
 * A day with no row is a day with no hours, which the form renders as closed. That is the
 * same thing the API means by absence: `PUT /v1/working-hours` deletes every day the body
 * does not name, so "not in the response" and "closed" are one state and not two.
 */
export function byDay(hours: readonly WorkingHour[]): Map<number, WorkingHour> {
  return new Map(hours.map((hour) => [hour.day_of_week, hour]))
}

/**
 * `HH:MM`, for an `<input type="time">`.
 *
 * The API answers `H:i:s`, and a time input refuses a value with seconds on it in some
 * browsers and silently blanks the field in others — which reads to the administrator as
 * "the clinic has no opening time" and is one save away from becoming true.
 */
export function toTimeInput(value: string | null | undefined): string {
  if (typeof value !== 'string' || value === '') {
    return ''
  }

  return value.slice(0, 5)
}

/**
 * The whole timetable, assembled from a submitted form.
 *
 * PUT ON A COLLECTION MEANS THE BODY IS THE TIMETABLE. A day that is not in the body is
 * deleted, so this builds all seven every time rather than only the ones that changed. A
 * merge-style submission would leave last season's Saturday quietly published to patients
 * and the first anybody would know is somebody standing at a locked door.
 *
 * A day marked closed is sent WITHOUT times. The columns behind them are NOT NULL, so the
 * controller writes midnight-to-midnight and nothing reads it while `is_closed` is true —
 * sending the times the administrator happened to leave in the boxes would be recording a
 * decision they did not make.
 */
export function weekFromForm(read: (name: string) => string | null): WeekChanges {
  return {
    days: WEEK.map((day) => {
      const closed = read(`closed-${day.value}`) !== null

      if (closed) {
        return { day_of_week: day.value, is_closed: true }
      }

      return {
        day_of_week: day.value,
        opens_at: read(`opens-${day.value}`) ?? '',
        closes_at: read(`closes-${day.value}`) ?? '',
        is_closed: false,
      }
    }),
  }
}

/**
 * Whether the clinic has published any opening hours at all.
 *
 * Worth its own function because the answer drives a warning rather than a label: a clinic
 * with no open day publishes no availability, so no patient can book anything, and the
 * screen should say that rather than showing seven empty rows and looking finished.
 */
export function opensAtAll(hours: readonly WorkingHour[]): boolean {
  return hours.some((hour) => !hour.is_closed)
}
