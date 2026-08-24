/**
 * The time box: how long a grant lasts, and how that becomes the instant the API wants.
 *
 * ============================================================
 * A LENGTH, NOT A DATE PICKER, AND THE REASON IS THE CONTRACT'S
 * ============================================================
 *
 * `StoreBreakGlassGrantRequest.expires_at` documents both ends of the box: "A grant that
 * starts in the past would be retrospective authorisation, and one that outruns the maximum
 * is standing access wearing an exception's costume."
 *
 * A `<input type="datetime-local">` posts a wall-clock string with no zone, so it can
 * produce both of those failures by accident — an operator whose laptop clock is slow types
 * a time that is already past, and one who types a date meaning Kampala gets an instant
 * somewhere else. Offering lengths removes the class entirely: the instant is computed on
 * the server, in UTC, from a clock nobody in the browser can set.
 *
 * ============================================================
 * WHAT THE MAXIMUM IS, IS NOT KNOWN HERE
 * ============================================================
 *
 * The contract says "no longer than a day" in prose and publishes no number. So this file
 * does not encode one: it offers short windows, the API refuses anything over its own
 * ceiling, and its refusal is shown in its own words. A maximum guessed here would be a
 * second rule free to disagree with the real one, and the disagreement would surface as an
 * emergency request refused during an incident for a reason the screen invented.
 *
 * ============================================================
 * THE SHORTEST OPTION IS FIRST AND IS THE ONLY ONE THAT IS NOT A DECISION
 * ============================================================
 *
 * An operator who still needs access at the end of an hour asks again, which writes a
 * second audit entry — and that is the point rather than a friction to design away. The
 * ordering makes the cheap choice the narrow one.
 */

export type Window = {
  readonly value: string
  readonly label: string
  readonly hours: number
}

export const WINDOWS: readonly Window[] = [
  { value: '1', label: '1 hour', hours: 1 },
  { value: '2', label: '2 hours', hours: 2 },
  { value: '4', label: '4 hours', hours: 4 },
  { value: '8', label: '8 hours', hours: 8 },
]

const HOUR_MS = 60 * 60 * 1000

/**
 * The instant this grant should end, or `null` if the form did not name a window this build
 * offers.
 *
 * `null` RATHER THAN A DEFAULT. Silently substituting the shortest window for an
 * unrecognised value would mean a request the operator did not make going through; the
 * caller turns `null` into "nothing was submitted" and shows the form again.
 */
export function expiresAt(choice: string): string | null {
  const window = WINDOWS.find((candidate) => candidate.value === choice)

  if (window === undefined) {
    return null
  }

  return new Date(Date.now() + window.hours * HOUR_MS).toISOString()
}
