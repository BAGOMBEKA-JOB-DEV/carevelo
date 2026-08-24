import type { Tenant } from '@/lib/tenant'
import { isKnownMethod, type PaymentIntent, type PaymentMethodValue } from '../api/types'

/**
 * What every payment-state screen is handed, in one place so the four of them cannot
 * drift apart.
 *
 * A separate module rather than a type exported from the panel that composes them: the
 * panel imports the screens, so a type living there would make the graph circular, and
 * dependency-cruiser counts a type-only import as an import (`tsPreCompilationDeps`).
 */
export type PaymentScreenProps = {
  tenant: Tenant
  intent: PaymentIntent
  /**
   * Where "Check again" points.
   *
   * DEFAULTS TO THE EMPTY STRING, WHICH IS NOT AN OVERSIGHT. `<a href="">` re-requests the
   * current URL, query string and all — precisely "ask the server again" — and it needs no
   * JavaScript, no server action to revalidate, and no knowledge inside this domain of what
   * the route composing it decided to call itself. A route with a reason to send the
   * patient somewhere else passes it.
   */
  checkAgainHref?: string | undefined
  /**
   * Where "Try another way to pay" points: the method chooser, carrying `after=<this
   * intent's id>` so the next attempt derives a NEW idempotency key. Absent means no retry
   * is offered on this screen.
   */
  retryHref?: string | undefined
}

/**
 * The catalogue key for a method the API sent us.
 *
 * `method` is `string` on the wire, so a value this build has never seen is possible and
 * must not throw. It renders under the neutral "This payment" label instead — wrong-ish,
 * but readable, which is the right trade on a screen whose job is to tell somebody whether
 * their money arrived.
 */
export function methodKeyOf(method: string): PaymentMethodValue | 'unknown' {
  return isKnownMethod(method) ? method : 'unknown'
}

/**
 * The clinic's name as a patient would say it.
 *
 * An empty trading name is treated as no trading name. The field is non-null in the
 * contract, and a blank one would otherwise render as a hole in the middle of a sentence
 * about who is being paid.
 */
export function clinicName(tenant: Tenant, fallback: string): string {
  return tenant.trading_name.trim() === '' ? fallback : tenant.trading_name
}
