import { readClient, writeClient } from './http'
import type { AggregatorAccount, AggregatorCredentials, VerificationResult } from '../model/types'

/**
 * The clinic connecting ITS OWN merchant account.
 *
 * ------------------------------------------------------------------------------
 * WHAT THIS IS, IN ONE SENTENCE THE SCREEN ALSO SAYS OUT LOUD.
 *
 * Money goes from the patient to the clinic's own account at a Bank of Uganda licensed
 * aggregator. Carevelo never holds it and cannot access it. That is not marketing copy
 * dressed as architecture — there IS no platform merchant account, because custody would
 * put Carevelo inside the NPS Act 2020 PSP or e-money categories and their UGX 250m–10bn
 * capital requirements. The sentence belongs on the screen because the clinic owner
 * reading it is rightly suspicious of software that touches their money, and because it is
 * the only place the person entering the credentials can read it.
 *
 * ------------------------------------------------------------------------------
 * CREDENTIALS ARE WRITE-ONLY AND THERE IS NOTHING TO READ BACK.
 *
 * `AggregatorAccountResource` enumerates four facts and no secret: provider, status,
 * environment, last verification — plus `accepts_online_payment`, which is the one
 * question a console is actually asking, and `credentials_are_write_only`, which is `true`
 * on every response. There is no field that could hold a key, no conditional that could
 * add one, and `AggregatorAccountPolicy::viewSecrets()` returns false for every role
 * including a platform operator with a break-glass grant.
 *
 * So: NO CONTROL IN THIS DOMAIN MAY READ A CREDENTIAL BACK. Not a masked display, not a
 * "reveal" toggle, not a pre-filled input showing the last four characters. There is
 * nothing to fill it with, and building the control would be building the expectation.
 * The consequence for the form is that saving is always a REPLACEMENT of the whole set —
 * which is also why the endpoint is PUT and why `secret_key` is required on it. A partial
 * credential update produces a half-rotated key pair that fails at the aggregator hours
 * later, in production, on a live collection.
 *
 * ------------------------------------------------------------------------------
 * AND NONE OF IT MAY BLOCK CARE.
 *
 * `status = unconfigured` is a WORKING STATE, not an error. §H1.6 is explicit: a clinic
 * with no merchant account completes onboarding, runs consultations, and takes payment at
 * the counter. `GET` returns 200 with `unconfigured` rather than 404 for exactly that
 * reason — a 404 would read to a console as an error and invite it to block booking over a
 * feature the clinic has chosen not to use. Every screen in this domain treats a missing
 * account as a state to describe, never a step to enforce.
 */

export async function getAggregatorAccount(): Promise<AggregatorAccount> {
  const client = await readClient()
  const response = await client.get<{ data: AggregatorAccount }>('/v1/tenant/aggregator-account')

  return response.data
}

/**
 * Store the clinic's credentials, replacing whatever was there.
 *
 * The status drops to `pending_verification` on every write, INCLUDING a write that only
 * rotates the webhook secret. That is the backend refusing to let an untested credential
 * claim to be active, and the screen should present it as the ordinary next step rather
 * than as a failure: an unverified key is how a clinic discovers at the counter that its
 * key expired last week.
 */
export async function saveAggregatorCredentials(
  credentials: AggregatorCredentials,
): Promise<AggregatorAccount> {
  const client = await writeClient()
  const response = await client.put<{ data: AggregatorAccount }>(
    '/v1/tenant/aggregator-account',
    credentials,
  )

  return response.data
}

/**
 * Check the credentials against the aggregator.
 *
 * A READ, NOT A TRANSACTION. The gateway is asked about a reference that does not exist,
 * which exercises exactly what needs exercising — whether the aggregator accepts this
 * clinic's key — and moves no money at all. Initiating a real collection to test a
 * credential would mean charging somebody to prove a configuration, and there is no
 * platform account for the shilling to land in.
 *
 * A FAILURE IS A 200. The controller catches `AggregatorUnavailable`, sets the status to
 * `failing`, and returns the aggregator's own message in `meta.verification_message` — so
 * a refused credential is an onboarding step to retry rather than a 500, and onboarding
 * continues either way. The message is passed to the screen VERBATIM: only the aggregator
 * knows why a key was refused, and paraphrasing loses the part the administrator can act
 * on.
 *
 * The one case that is NOT a 200 is verifying with no credentials stored at all, which is
 * a 409 with a sentence saying so. That is left to throw — the caller turns it into the
 * same message it would show for any other refusal.
 */
export async function verifyAggregatorAccount(): Promise<VerificationResult> {
  const client = await writeClient()
  const response = await client.post<{
    data: AggregatorAccount
    meta?: { verification_message?: string | null }
  }>('/v1/tenant/aggregator-account/verify')

  const message = response.meta?.verification_message

  return {
    account: response.data,
    message: typeof message === 'string' && message !== '' ? message : null,
  }
}
