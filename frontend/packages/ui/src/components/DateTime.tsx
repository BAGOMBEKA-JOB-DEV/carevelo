import type { ReactElement } from 'react'
import { cx } from './classNames'

/**
 * An instant from the API, shown in the time the clinic keeps.
 *
 * THE API SENDS UTC; UGANDA READS EAT. `docs/40-api/api-conventions.md`: "Stored and
 * transmitted in UTC. Displayed in Africa/Kampala. Never transmit a local time without an
 * offset." Everything that reaches this component is an ISO-8601 string with a `Z`, and
 * everything that leaves it is the same instant read off a clock in Kampala.
 *
 * THE ZONE IS NAMED, NEVER OFFSET. Uganda is UTC+3 and has no daylight saving, so `+3`
 * looks safe and is the kind of shortcut that survives right up until it does not — a zone
 * database change, a second country, a test that runs with a faked clock. `Africa/Kampala`
 * costs nothing and is the thing the requirement actually says.
 *
 * AND IT IS NAMED HERE RATHER THAN INHERITED. `Intl` defaults to the HOST's zone, and the
 * host is a Node process in a data centre — almost certainly UTC. Left to the default, an
 * appointment at 09:00 EAT server-renders as "06:00", and then flips to "09:00" when a
 * client component re-renders it on a phone set to Kampala. Three hours is enough to move
 * a date, so the bug does not look like a timezone bug; it looks like the wrong day. An
 * explicit `timeZone` also means server and client produce the same characters, which is
 * what keeps this out of the hydration mismatch that would follow.
 *
 * WHY IT IS A SERVER COMPONENT. `Intl.DateTimeFormat` exists in both places and, pinned to
 * a zone, gives the same answer in both — so there is nothing here that needs a browser
 * and no reason to spend a byte of the patient portal's budget on one.
 *
 * TIMES ARE 24-HOUR. The clinic's own working hours are configured and validated as `H:i`
 * — see `UpdateWorkingHoursRequest::TIME_FORMATS` — so a schedule rendered as "2:30" would
 * disagree with the form the clinic filled in. It is also the ambiguity worth designing
 * out: a patient who reads "7:30" for an appointment and arrives twelve hours off has had
 * a bad day because of a display decision.
 *
 * WHAT IS NOT HERE: relative time ("in 2 hours"). It needs a clock to be live, which means
 * a client component and an interval, and it re-introduces the hydration mismatch this
 * component exists to avoid — the server's "in 2 hours" is the client's "in 1 hour" if the
 * page sat in a tab. When a screen genuinely needs it, it belongs to that screen.
 *
 * @example
 * <DateTime value={appointment.scheduled_start_at} format="datetime" />  // 21 Aug 2026, 14:30
 * <DateTime value={prescription.issued_at} />                            // 21 Aug 2026
 */

export type DateTimeFormat = 'date' | 'time' | 'datetime'

export type DateTimeProps = {
  /** An ISO-8601 instant, as the API sends it: UTC, with the `Z`. */
  value: string
  format?: DateTimeFormat | undefined
  className?: string | undefined
}

const KAMPALA = 'Africa/Kampala'

/* en-GB: day before month, and no am/pm. The product is written in British English
   throughout — "colour", "organisation" — and the date order matches what a Ugandan form
   asks for. Pinned rather than left to the runtime, for the same reason the zone is. */
const LOCALE = 'en-GB'

const OPTIONS: Record<DateTimeFormat, Intl.DateTimeFormatOptions> = {
  date: { timeZone: KAMPALA, day: 'numeric', month: 'short', year: 'numeric' },
  time: { timeZone: KAMPALA, hour: '2-digit', minute: '2-digit', hour12: false },
  datetime: {
    timeZone: KAMPALA,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  },
}

/* Built once per format and reused. Constructing an Intl.DateTimeFormat is the expensive
   part of formatting — it resolves a locale and a zone — and a pharmacy queue renders
   fifty of these in one pass. */
const FORMATTERS: Record<DateTimeFormat, Intl.DateTimeFormat> = {
  date: new Intl.DateTimeFormat(LOCALE, OPTIONS.date),
  time: new Intl.DateTimeFormat(LOCALE, OPTIONS.time),
  datetime: new Intl.DateTimeFormat(LOCALE, OPTIONS.datetime),
}

/**
 * The string, for the places a component cannot go — a document title, an `aria-label`, a
 * `<option>` label.
 */
export function formatInstant(value: string, format: DateTimeFormat = 'date'): string {
  const instant = new Date(value)

  if (Number.isNaN(instant.getTime())) {
    /* Loud rather than "Invalid Date" in front of a patient. The offending value is
       deliberately not in the message: it ends up in a log, and a timestamp attached to a
       named person is the sort of thing that should not accumulate there. */
    throw new RangeError(
      'DateTime was given a value that is not a parseable instant. The API sends ISO-8601 '
        + 'in UTC; a hand-built local time without an offset cannot be placed on a clock.',
    )
  }

  return FORMATTERS[format].format(instant)
}

export function DateTime({ value, format = 'date', className }: DateTimeProps): ReactElement {
  return (
    /* <time> with the original UTC string in `dateTime`: the machine-readable instant stays
       unambiguous in the markup while the human-readable one is local, which is what the
       element is for. `.tnum` keeps a column of times from shifting width as digits change. */
    <time className={cx('tnum', className)} dateTime={value}>
      {formatInstant(value, format)}
    </time>
  )
}
