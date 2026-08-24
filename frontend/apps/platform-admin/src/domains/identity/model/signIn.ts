/**
 * The shape of a platform sign-in: two steps, and what can go wrong on each.
 *
 * ============================================================
 * WHY THERE ARE TWO STEPS AND NOT ONE FORM
 * ============================================================
 *
 * A single form taking an email address, a password and a code has to tell the person
 * which of the three was wrong — and "your password is correct, your code is not" is a
 * valuable sentence to hand somebody working through a credential-stuffing list. It tells
 * them the address is real, the password is right, and that all that remains is six
 * digits. The API is built the same way for the same reason: `POST
 * /v1/platform/auth/sign-in` proves a password and opens NO SESSION AT ALL, and
 * `POST /v1/platform/auth/challenge` is the request that actually signs anybody in.
 *
 * So this app cannot merge the two even if it wanted to, and the split on screen matches
 * the split in the contract rather than decorating it.
 *
 * ============================================================
 * WHICH STEP IS SHOWING LIVES IN THE URL
 * ============================================================
 *
 * This surface ships no client JavaScript: the forms post natively to Server Actions and
 * everything an action learned is gone unless it is in the URL. The pending challenge
 * itself is server-side state behind an HTTP-only cookie, which this app cannot read and
 * must not try to — `?step=code` is a hint about which form to draw, and nothing else.
 * Typing it by hand shows the code form, the code is refused with `challenge_expired`, and
 * the operator is sent back to the password step. There is no state here worth protecting
 * because there is no authority here at all.
 *
 * @see docs/40-api/authentication-and-sessions.md § Second factor
 */

/** Which form to draw. */
export type SignInStep = 'password' | 'code'

export function stepFrom(raw: string | undefined): SignInStep {
  return raw === 'code' ? 'code' : 'password'
}

/**
 * What the last attempt did, as something a screen can switch on.
 *
 * Derived from the API's STABLE `code` and never from its sentence. `title` and `detail`
 * are written for humans and may be reworded freely; `code` is the machine-readable half
 * of RFC 9457 and is the contract. A screen keyed on the sentence changes behaviour when
 * somebody fixes a typo on the backend.
 */
export type SignInProblem =
  /** Wrong address, wrong password, or no such platform account. One answer for all three. */
  | 'rejected'
  /** The code did not match: wrong, expired, replayed, or a recovery code that is spent. */
  | 'code_rejected'
  /** The password was right and the account has no authenticator. Enrolment is out of band. */
  | 'not_enrolled'
  /** No live pending challenge. The five minutes ran out, or the step was skipped. */
  | 'expired'
  /** The limiter. Deliberately the same on both steps so neither can be probed. */
  | 'throttled'
  /** Something else, including the API being unreachable. */
  | 'failed'

const PROBLEMS: readonly SignInProblem[] = [
  'rejected',
  'code_rejected',
  'not_enrolled',
  'expired',
  'throttled',
  'failed',
]

/** A `?problem=` value, or undefined if it is not one this screen knows. */
export function problemFrom(raw: string | undefined): SignInProblem | undefined {
  return PROBLEMS.find((problem) => problem === raw)
}

/**
 * The API's problem `code` for a failed sign-in, mapped to what the screen draws.
 *
 * A 422 is a validation failure on the credential and reads as `rejected` or
 * `code_rejected` depending on which step raised it — the API answers the same status for
 * a wrong password and a wrong code, and the step is the only thing that distinguishes
 * them.
 */
export function problemFor(step: SignInStep, code: string | null, status: number): SignInProblem {
  if (code === 'second_factor_not_enrolled') {
    return 'not_enrolled'
  }

  if (code === 'challenge_expired') {
    return 'expired'
  }

  if (code === 'too_many_attempts' || status === 429) {
    return 'throttled'
  }

  if (status === 422) {
    return step === 'code' ? 'code_rejected' : 'rejected'
  }

  return 'failed'
}

/** Where the two screens live. The route layer owns the value; this domain never invents one. */
export type IdentityPaths = {
  /** The sign-in route itself, which both steps post back to. */
  readonly signIn: string
  /** Where an operator lands once the code has verified. */
  readonly afterSignIn: string
}
