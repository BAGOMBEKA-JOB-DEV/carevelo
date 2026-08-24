/**
 * Turning a chosen trial length into the instant the contract wants.
 *
 * WHY A LENGTH AND NOT A DATE PICKER. `trial_ends_at` is a date-time, and a
 * `<input type="datetime-local">` posts a wall-clock string with no zone — so a value typed
 * by an operator in Kampala and one typed by an operator anywhere else mean different
 * instants while looking identical, and neither is what the API parses. Offering lengths
 * instead removes the class of bug entirely: the instant is computed here, on the server,
 * in UTC, from a clock the operator cannot set.
 *
 * THE OPTIONS ARE COMMERCIAL, NOT TECHNICAL, and they are the only commercial control in
 * this app. There is no plan, no price and no invoice anywhere in docs/40-api/openapi.yaml;
 * `UpdateTenantRequest` carries exactly `status` and `trial_ends_at`, and its own
 * description says why: "COMMERCIAL fields only." A billing screen here would be a model
 * this product does not have, drawn convincingly.
 *
 * `null` IS A REAL CHOICE and not an empty one. `trial_ends_at` is nullable in the
 * contract, and clearing it says "no trial is running" — which is a different statement
 * from "the trial ended", and the difference is exactly what an operator looking at a
 * clinic that has been active for a year wants to see.
 */

export type TrialOption = {
  readonly value: string
  readonly label: string
  /** Days from now, or `null` to clear the trial. */
  readonly days: number | null
}

/**
 * `keep` is first and is the default on every form that offers this, because the commonest
 * lifecycle change — suspending a clinic, resuming it — should not silently move its trial
 * as a side effect. A control that changes two things when the operator meant one is how a
 * clinic ends up with a trial nobody granted.
 */
export const TRIAL_OPTIONS: readonly TrialOption[] = [
  { value: 'keep', label: 'Leave the trial as it is', days: 0 },
  { value: '14', label: 'Ends in 14 days', days: 14 },
  { value: '30', label: 'Ends in 30 days', days: 30 },
  { value: '60', label: 'Ends in 60 days', days: 60 },
  { value: 'none', label: 'No trial — clear the date', days: null },
]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * What a chosen option means for the request body.
 *
 * Three outcomes, and they are genuinely three: `undefined` leaves the field off the PATCH
 * entirely (a PATCH omits what it does not change), `null` clears it, and a string sets it.
 * Collapsing "leave alone" and "clear" into one value is the bug this return type prevents.
 */
export function trialEndsAt(choice: string): string | null | undefined {
  const option = TRIAL_OPTIONS.find((candidate) => candidate.value === choice)

  if (option === undefined || option.value === 'keep') {
    return undefined
  }

  if (option.days === null) {
    return null
  }

  return new Date(Date.now() + option.days * DAY_MS).toISOString()
}
