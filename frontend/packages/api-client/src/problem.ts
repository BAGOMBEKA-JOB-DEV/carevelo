/**
 * RFC 9457 problem details, turned into something a person can act on.
 *
 * The API returns problem+json for every failure
 * (docs/40-api/api-conventions.md). Surfacing that object raw is a support call:
 * "a clinic administrator seeing a raw validation payload is a support call", per
 * frontend-nextjs.md. So every failure leaves this module as a sentence.
 *
 * Two rules that are not stylistic:
 *
 * 1. AGGREGATOR MESSAGES PASS THROUGH VERBATIM. Only the aggregator knows why a
 *    mobile-money collection failed, and paraphrasing loses the part the patient can
 *    act on — "insufficient balance" and "wrong PIN" need different actions from the
 *    person holding the handset.
 * 2. A cross-tenant reference is a 404, never a 403, and this module must not
 *    "helpfully" explain otherwise. The backend deliberately refuses to confirm that
 *    a record exists in another clinic.
 */

/** RFC 9457. `errors` is Laravel's validation bag, which the API preserves. */
export interface Problem {
  type?: string
  title?: string
  status?: number
  /**
   * The stable, machine-readable slug. KEY ON THIS AND NOT ON `title`, which the API
   * documents as rewordable copy.
   *
   * It was missing from this interface while the backend sent it on every error, so
   * callers that needed it — the platform sign-in has to tell `second_factor_required`
   * apart from an ordinary refusal, and both are a 403 — re-derived it from the raw
   * payload by hand. Every field the API guarantees belongs here once.
   */
  code?: string
  detail?: string
  instance?: string
  errors?: Record<string, string[]>
  /** Passed through untouched from the payment aggregator, where present. */
  aggregator_message?: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Field-level messages for a form, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    const errors = this.problem.errors ?? {}

    return Object.fromEntries(
      Object.entries(errors).map(([field, messages]) => [field, messages[0] ?? '']),
    )
  }

  /** Whether retrying unchanged could plausibly succeed. */
  get isTransient(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500
  }
}

/**
 * The sentence to show a human.
 *
 * Deliberately does not invent copy for a 404: the caller knows what the user was
 * looking for and can say so, whereas this module would have to guess.
 */
export function humanise(status: number, problem: Problem): string {
  // Verbatim, and first. See rule 1 above.
  if (problem.aggregator_message) {
    return problem.aggregator_message
  }

  const firstFieldError = Object.values(problem.errors ?? {})[0]?.[0]

  if (firstFieldError) {
    return firstFieldError
  }

  if (problem.detail) {
    return problem.detail
  }

  switch (status) {
    case 401:
      return 'Your session has ended. Please sign in again.'
    case 403:
      return 'You do not have permission to do that.'
    case 404:
      return 'That could not be found.'
    case 409:
      return 'That has already changed. Please review it and try again.'
    case 419:
      return 'Your session has expired. Please reload the page.'
    case 422:
      return 'Please check the details and try again.'
    case 429:
      return 'Too many attempts. Please wait a moment and try again.'
    default:
      return status >= 500
        ? 'Something went wrong at our end. Please try again shortly.'
        : problem.title ?? 'That did not work.'
  }
}
